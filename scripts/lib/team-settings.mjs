import { readFile } from "node:fs/promises";
import path from "node:path";
import { decryptPayload } from "./dashboard-data.mjs";

export function validateTeamSettings(value, config) {
  if (value?.version !== 1 || !value.employees || typeof value.employees !== "object" || Array.isArray(value.employees)) throw new Error("Invalid team account settings.");
  const employees = {};
  const emails = new Set();
  const passwords = new Set();
  for (const [id, entry] of Object.entries(value.employees)) {
    if (!config.employees.some(e => e.id === id && e.onboarding)) throw new Error("Only new employee accounts can be configured here.");
    const email = typeof entry?.email === "string" ? entry.email.trim().toLowerCase() : "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254 || emails.has(email)) throw new Error("Enter a distinct valid email for each team member.");
    if (typeof entry.password !== "string" || entry.password.length < 20 || entry.password.length > 160 || passwords.has(entry.password)) throw new Error("Each team member needs a distinct strong password.");
    const pay = entry.compensation;
    if (!pay || !["hourly", "commission", "pending"].includes(pay.type)) throw new Error("Choose a pay setup for each team member.");
    if (pay.type === "hourly" && (!Number.isSafeInteger(pay.hourlyCents) || pay.hourlyCents < 100 || pay.hourlyCents > 100000)) throw new Error("Check the hourly rate.");
    if (pay.type === "commission" && (!Number.isFinite(pay.rate) || pay.rate <= 0 || pay.rate > 1)) throw new Error("Check the percentage rate.");
    employees[id] = { email, password: entry.password, compensation: pay.type === "hourly" ? { type: "hourly", hourlyCents: pay.hourlyCents } : pay.type === "commission" ? { type: "commission", rate: pay.rate } : { type: "pending" } };
    emails.add(email); passwords.add(entry.password);
  }
  return { version: 1, employees };
}

export async function readTeamSettings(root, config, ownerPassword) {
  try {
    const envelope = JSON.parse(await readFile(path.join(root, "public/data/team-settings.json"), "utf8"));
    return validateTeamSettings(decryptPayload(envelope, ownerPassword), config);
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, employees: {} };
    throw new Error("Private team settings could not be opened. Existing account credentials were not replaced.", { cause: error });
  }
}

export function teamPasswords(config, settings, environment = process.env) {
  const result = {};
  for (const entry of [{ id: "owner" }, ...config.employees]) {
    const password = environment[`DASHBOARD_PASSWORD_${entry.id.toUpperCase()}`] || settings.employees[entry.id]?.password;
    if (!password && entry.onboarding) continue;
    if (!password || password.length < 16) throw new Error(`Missing strong dashboard password for ${entry.id}.`);
    result[entry.id] = password;
  }
  return result;
}

export function resolveEmployees(config, settings, passwords, environment = process.env) {
  const usedEmails = new Set();
  return config.employees.map(employee => {
    const saved = settings.employees[employee.id];
    const rawEmail = environment[employee.emailEnvironmentVariable] || saved?.email || "";
    const invitationEmails = [...new Set(rawEmail.split(/[,;\r\n]+/).map(email => email.trim().toLowerCase()).filter(Boolean))];
    if (!invitationEmails.length && !employee.onboarding) throw new Error(`Missing required environment variable: ${employee.emailEnvironmentVariable}`);
    if (invitationEmails.some(email => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || usedEmails.has(email))) throw new Error("Employee invitation emails must be valid and belong to one employee.");
    invitationEmails.forEach(email => usedEmails.add(email));
    const compensation = saved?.compensation ?? employee.compensation;
    return { ...employee, compensation, ...(compensation?.type === "commission" ? { commissionRate: compensation.rate } : {}),
      email: invitationEmails[0], invitationEmails, accessReady: Boolean(passwords[employee.id] && invitationEmails.length) };
  });
}
