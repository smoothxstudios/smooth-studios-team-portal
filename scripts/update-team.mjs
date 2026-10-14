import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decryptPayload, encryptPayload } from "./lib/dashboard-data.mjs";
import { readTeamSettings, validateTeamSettings, resolveEmployees, teamPasswords } from "./lib/team-settings.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(root, "config/studio.config.json"), "utf8"));
const ownerPassword = process.env.DASHBOARD_PASSWORD_OWNER;
if (!ownerPassword || ownerPassword.length < 16) throw new Error("The owner password is required.");
const serialized = process.env.TEAM_SETTINGS_ENVELOPE ?? "";
if (!serialized || serialized.length > 56000) throw new Error("The encrypted team setup is missing or too large.");
const incoming = validateTeamSettings(decryptPayload(JSON.parse(serialized), ownerPassword), config);
const existing = await readTeamSettings(root, config, ownerPassword);
for (const id of Object.keys(incoming.employees)) {
  if (existing.employees[id] && JSON.stringify(existing.employees[id]) !== JSON.stringify(incoming.employees[id])) throw new Error("This account is already activated. Refresh the dashboard before continuing.");
}
const settings = validateTeamSettings({ version: 1, employees: { ...existing.employees, ...incoming.employees } }, config);
resolveEmployees(config, settings, teamPasswords(config, settings));
await writeFile(path.join(root, "public/data/team-settings.json"), `${JSON.stringify(encryptPayload(settings, ownerPassword))}\n`);
process.stdout.write(`Prepared ${Object.keys(incoming.employees).length} private employee accounts.\n`);
