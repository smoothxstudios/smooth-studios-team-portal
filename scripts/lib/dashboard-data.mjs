import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { categorizeAppointment } from "../../lib/appointment-categories.mjs";
import { summarizeStripeSnapshot } from "./stripe-data.mjs";

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

function normalizedEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizedName(value) {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim() : "";
}

function addStripeMatch(assignments, eventId, charge, confidence) {
  const existing = assignments.get(eventId) ?? [];
  existing.push({ charge, confidence });
  assignments.set(eventId, existing);
}

function assignedStripeTotal(assignments, eventId) {
  return (assignments.get(eventId) ?? []).reduce((sum, match) => sum + match.charge.receivedCents, 0);
}

function stripeCandidateScore(candidate, charge, assignments) {
  if (charge.receivedCents <= 0) return Number.NEGATIVE_INFINITY;
  const created = new Date(charge.created).getTime();
  const start = new Date(candidate.start).getTime();
  const end = new Date(candidate.end).getTime();
  const earliest = start - 370 * 86400000;
  const latest = end + 370 * 86400000;
  if (!Number.isFinite(created) || created < earliest || created > latest) return Number.NEGATIVE_INFINITY;

  const chargeEmail = normalizedEmail(charge.customerEmail);
  const chargeName = normalizedName(charge.customerName);
  const eventEmail = normalizedEmail(candidate.parsed.email);
  const eventName = normalizedName(candidate.parsed.name ?? candidate.customer);
  const emailMatch = Boolean(eventEmail && chargeEmail && eventEmail === chargeEmail);
  const nameMatch = Boolean(eventName && chargeName && eventName === chargeName);
  const nameInStripeText = Boolean(eventName && normalizedName(charge.searchText).includes(eventName));
  if (!emailMatch && !nameMatch && !nameInStripeText) return Number.NEGATIVE_INFINITY;

  let score = emailMatch ? 120 : 0;
  if (nameMatch) score += 70;
  else if (nameInStripeText) score += 28;

  const alreadyReceived = assignedStripeTotal(assignments, candidate.id);
  const remaining = Math.max(candidate.parsed.priceCents - alreadyReceived, 0);
  if (charge.receivedCents === remaining && remaining > 0) score += 58;
  else if (charge.receivedCents === candidate.parsed.priceCents) score += 45;
  else if (charge.receivedCents < candidate.parsed.priceCents) score += 22;
  else score += 14;

  const distanceDays = created <= start
    ? (start - created) / 86400000
    : (created - end) / 86400000;
  if (distanceDays <= 7) score += 36;
  else if (distanceDays <= 45) score += 27;
  else if (distanceDays <= 180) score += 16;
  else score += 5;

  return score;
}

export function reconcileStripePayments(calendarEvents, stripeCharges = []) {
  const candidates = calendarEvents
    .filter((event) => event?.status !== "cancelled" && event.start?.dateTime && event.end?.dateTime)
    .map((event) => {
      const parsed = parseCalendarDescription(event.description);
      if (parsed.priceCents === null) return null;
      return {
        id: event.id,
        start: event.start.dateTime,
        end: event.end.dateTime,
        customer: parsed.name ?? summaryCustomer(event.summary),
        parsed,
      };
    })
    .filter(Boolean);
  const assignments = new Map();
  const matchedChargeIds = new Set();
  const charges = stripeCharges
    .filter((charge) => charge?.id && charge.receivedCents > 0)
    .sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());

  for (const charge of charges) {
    const exactCandidates = candidates.filter((candidate) =>
      candidate.parsed.acuityId && charge.searchText.includes(candidate.parsed.acuityId.toLowerCase()),
    );
    if (exactCandidates.length === 1) {
      addStripeMatch(assignments, exactCandidates[0].id, charge, "acuity-id");
      matchedChargeIds.add(charge.id);
    }
  }

  for (const charge of charges) {
    if (matchedChargeIds.has(charge.id)) continue;
    const scored = candidates
      .map((candidate) => ({ candidate, score: stripeCandidateScore(candidate, charge, assignments) }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score);
    const first = scored[0];
    const second = scored[1];
    if (!first || first.score < 145 || (second && first.score - second.score < 25)) continue;
    addStripeMatch(assignments, first.candidate.id, charge, "high");
    matchedChargeIds.add(charge.id);
  }

  const paymentsByEventId = Object.fromEntries(
    [...assignments.entries()].map(([eventId, matches]) => [
      eventId,
      {
        receivedCents: matches.reduce((sum, match) => sum + match.charge.receivedCents, 0),
        grossCents: matches.reduce((sum, match) => sum + match.charge.capturedCents, 0),
        refundedCents: matches.reduce((sum, match) => sum + match.charge.refundedCents, 0),
        feeCents: matches.reduce((sum, match) => sum + match.charge.feeCents, 0),
        netCents: matches.reduce((sum, match) => sum + match.charge.netCents, 0),
        paymentCount: matches.length,
        matchConfidence: matches.every((match) => match.confidence === "acuity-id") ? "acuity-id" : "high",
        disputed: matches.some((match) => match.charge.disputed),
      },
    ]),
  );
  const unmatchedPayments = charges
    .filter((charge) => !matchedChargeIds.has(charge.id))
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .map((charge) => ({
      reference: charge.id.slice(-8),
      created: charge.created,
      amountCents: charge.receivedCents,
      refundedCents: charge.refundedCents,
      customerName: charge.customerName,
      customerEmail: charge.customerEmail,
      description: charge.description,
      disputed: charge.disputed,
    }));

  return { paymentsByEventId, matchedChargeIds, unmatchedPayments };
}

export function normalizeCalendarEvent(event, config, ledger, paymentOverrides = {}, stripePayment = null) {
  if (!event || event.status === "cancelled") return null;
  const start = event.start?.dateTime;
  const end = event.end?.dateTime;
  if (!start || !end || new Date(end).getTime() < new Date(config.importStart).getTime()) return null;

  const parsed = parseCalendarDescription(event.description);
  if (parsed.priceCents === null) return null;
  const override = paymentOverrides[event.id];
  const recordedPaymentCents = stripePayment?.receivedCents ?? parsed.paidOnlineCents;
  const paidAtLeastPrice = recordedPaymentCents !== null && recordedPaymentCents >= parsed.priceCents;
  const fullyPaid = typeof override === "boolean" ? override : paidAtLeastPrice && !stripePayment?.disputed;
  const tipCents = recordedPaymentCents === null ? 0 : Math.max(recordedPaymentCents - parsed.priceCents, 0);
  const paymentSource = typeof override === "boolean"
    ? "manual"
    : stripePayment
      ? "stripe"
      : parsed.paidOnlineCents !== null
        ? "calendar"
        : "none";

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
    paidOnlineCents: recordedPaymentCents,
    calendarPaidOnlineCents: parsed.paidOnlineCents,
    tipCents,
    fullyPaid,
    paymentSource,
    ...(stripePayment ? { stripePayment } : {}),
    ...(typeof override === "boolean" ? { paymentOverride: override } : {}),
    assignedEmployeeIds: assignedEmployees.map((employee) => employee.id),
    employeePayouts,
  };
}

export function buildDashboardPayloads({ calendarEvents, config, ledger, overrides, source, ownerWorkflowToken, stripeSnapshot = null }) {
  const reconciliation = reconcileStripePayments(calendarEvents, stripeSnapshot?.charges ?? []);
  const rentals = calendarEvents
    .map((event) => normalizeCalendarEvent(
      event,
      config,
      ledger,
      overrides.events ?? {},
      reconciliation.paymentsByEventId[event.id] ?? null,
    ))
    .filter(Boolean)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const generatedAt = new Date().toISOString();
  const common = {
    version: 1,
    source,
    generatedAt,
    calendarName: config.calendarName,
    integrations: { calendar: true, stripe: Boolean(stripeSnapshot) },
  };
  const dashboardEmployees = config.employees.map(dashboardEmployee);

  const owner = {
    ...common,
    role: "owner",
    user: { id: "owner", name: config.owner.name, accent: "#e10000" },
    employees: dashboardEmployees,
    rentals,
    ...(stripeSnapshot ? {
      stripeSummary: summarizeStripeSnapshot(stripeSnapshot, reconciliation.matchedChargeIds),
      unmatchedStripePayments: reconciliation.unmatchedPayments,
    } : {}),
    ...(ownerWorkflowToken ? {
      workflowAccess: {
        provider: "github",
        repository: config.repository,
        allowedLogin: config.repository.split("/")[0],
        accessToken: ownerWorkflowToken,
      },
    } : {}),
  };
  const employeePayloads = Object.fromEntries(
    config.employees.map((employee) => {
      const visibleEmployee = dashboardEmployee(employee);
      const filteredRentals = rentals
        .filter((rental) => rental.assignedEmployeeIds.includes(employee.id))
        .map((rental) => {
          const employeeRental = { ...rental };
          delete employeeRental.stripePayment;
          delete employeeRental.calendarPaidOnlineCents;
          return {
            ...employeeRental,
            assignedEmployeeIds: [employee.id],
            employeePayouts: { [employee.id]: rental.employeePayouts[employee.id] },
          };
        });
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
