import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { categorizeAppointment } from "../../lib/appointment-categories.mjs";

const KDF_ITERATIONS = 310_000;

export function parseMoneyToCents(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[$,\s]/g, "");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

export function parseCalendarDescription(description = "") {
  const fields = {};
  for (const line of description.split(/\r?\n/)) {
    const match = line.match(/^\s*(Name|Phone|Email|Price|Paid Online|Calendar)\s*:\s*(.*?)\s*$/i);
    if (match) fields[match[1].toLowerCase().replace(/\s+/g, "")] = match[2];
  }
  const acuityMatch = description.match(/\bAcuityID\s*=\s*([^\s]+)/i);
  if (acuityMatch) fields.acuityId = acuityMatch[1];
  return {
    calendar: fields.calendar ?? null,
    name: fields.name ?? null,
    phone: fields.phone ?? null,
    email: fields.email ?? null,
    priceCents: parseMoneyToCents(fields.price),
    paidOnlineCents: parseMoneyToCents(fields.paidonline),
    acuityId: fields.acuityId ?? null,
  };
}

function summaryCustomer(summary = "") {
  const colon = summary.indexOf(":");
  return colon > 0 ? summary.slice(0, colon).trim() : "Studio customer";
}

function summaryRentalType(summary = "") {
  const colon = summary.indexOf(":");
  const value = colon >= 0 ? summary.slice(colon + 1).trim() : summary.trim();
  return value.replace(/\s*\(Smooth Studios\)\s*$/i, "") || "Studio Rental";
}

function paidByCutoff(end, cutoff) {
  if (!cutoff) return false;
  return end.slice(0, 10) <= cutoff;
}

function employeeInvitationEmails(employee) {
  const configured = Array.isArray(employee.invitationEmails) ? employee.invitationEmails : [employee.email];
  return configured.map((email) => email?.trim().toLowerCase()).filter(Boolean);
}

function dashboardEmployee(employee) {
  return { id: employee.id, name: employee.name, email: employee.email, accent: employee.accent };
}

export function normalizeCalendarEvent(event, config, ledger, paymentOverrides = {}) {
  if (!event || event.status === "cancelled") return null;
  const start = event.start?.dateTime;
  const end = event.end?.dateTime;
  if (!start || !end || new Date(end).getTime() < new Date(config.importStart).getTime()) return null;

  const parsed = parseCalendarDescription(event.description);
  if (parsed.priceCents === null) return null;
  const override = paymentOverrides[event.id];
  const paidAtLeastPrice = parsed.paidOnlineCents !== null && parsed.paidOnlineCents >= parsed.priceCents;
  const fullyPaid = typeof override === "boolean" ? override : paidAtLeastPrice;
  const tipCents = parsed.paidOnlineCents === null ? 0 : Math.max(parsed.paidOnlineCents - parsed.priceCents, 0);

  const acceptedEmails = new Set(
    (event.attendees ?? [])
      .filter((attendee) => attendee.responseStatus === "accepted")
      .map((attendee) => attendee.email?.trim().toLowerCase())
      .filter(Boolean),
  );
  const assignedEmployees = config.employees.filter((employee) =>
    employeeInvitationEmails(employee).some((email) => acceptedEmails.has(email)),
  );
  const amountCents = Math.round(parsed.priceCents * config.commissionRate);
  const title = summaryRentalType(event.summary);
  const category = categorizeAppointment(title);
  const employeePayouts = Object.fromEntries(
    assignedEmployees.map((employee) => [
      employee.id,
      {
        amountCents,
        paid: fullyPaid && new Date(end).getTime() <= Date.now() && paidByCutoff(end, ledger.employees?.[employee.id]?.paidThrough),
        ...(ledger.employees?.[employee.id]?.paidThrough ? { paidAt: ledger.employees[employee.id].paidThrough } : {}),
      },
    ]),
  );

  return {
    id: event.id,
    title,
    categoryId: category.id,
    category: category.label,
    customer: parsed.name ?? summaryCustomer(event.summary),
    start,
    end,
    priceCents: parsed.priceCents,
    paidOnlineCents: parsed.paidOnlineCents,
    tipCents,
    fullyPaid,
    ...(typeof override === "boolean" ? { paymentOverride: override } : {}),
    assignedEmployeeIds: assignedEmployees.map((employee) => employee.id),
    employeePayouts,
  };
}

export function buildDashboardPayloads({ calendarEvents, config, ledger, overrides, source }) {
  const rentals = calendarEvents
    .map((event) => normalizeCalendarEvent(event, config, ledger, overrides.events ?? {}))
    .filter(Boolean)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const generatedAt = new Date().toISOString();
  const common = {
    version: 1,
    source,
    generatedAt,
    calendarName: config.calendarName,
  };
  const dashboardEmployees = config.employees.map(dashboardEmployee);

  const owner = {
    ...common,
    role: "owner",
    user: { id: "owner", name: config.owner.name, accent: "#e10000" },
    employees: dashboardEmployees,
    rentals,
  };
  const employeePayloads = Object.fromEntries(
    config.employees.map((employee) => {
      const visibleEmployee = dashboardEmployee(employee);
      const filteredRentals = rentals
        .filter((rental) => rental.assignedEmployeeIds.includes(employee.id))
        .map((rental) => ({
          ...rental,
          assignedEmployeeIds: [employee.id],
          employeePayouts: { [employee.id]: rental.employeePayouts[employee.id] },
        }));
      return [employee.id, { ...common, role: "employee", user: visibleEmployee, employees: [visibleEmployee], rentals: filteredRentals }];
    }),
  );
  return { owner, ...employeePayloads };
}

export function encryptPayload(payload, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, KDF_ITERATIONS, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]);
  return {
    version: 1,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: KDF_ITERATIONS,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export async function writeEncryptedDashboards({ payloads, passwords, outputDirectory, config }) {
  await mkdir(outputDirectory, { recursive: true });
  const profiles = [
    { id: "owner", label: "Smooth", role: "owner" },
    ...config.employees.map((employee) => ({ id: employee.id, label: employee.name, role: "employee" })),
  ];
  for (const profile of profiles) {
    const password = passwords[profile.id];
    if (!password || password.length < 16) throw new Error(`Missing strong password for ${profile.id}`);
    const envelope = encryptPayload(payloads[profile.id], password);
    await writeFile(path.join(outputDirectory, `${profile.id}.json`), `${JSON.stringify(envelope)}\n`, "utf8");
  }
  await writeFile(path.join(outputDirectory, "access.json"), `${JSON.stringify({ version: 1, profiles }, null, 2)}\n`, "utf8");
}

export function generatePassword() {
  return `SS-${randomBytes(18).toString("base64url")}`;
}

export function stableEventFingerprint(event) {
  return createHash("sha256").update(`${event.id}|${event.updated ?? ""}|${event.start?.dateTime ?? ""}`).digest("hex");
}
