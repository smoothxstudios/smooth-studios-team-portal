import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readTeamSettings } from "./lib/team-settings.mjs";
import { initializePayAdjustments, markEmployeeThrough, validatePaidThrough } from "./lib/employee-pay.mjs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
const paidThrough = args.get("through");
const employeeId = args.get("employee") ?? "all";

const config = JSON.parse(await readFile(path.join(root, "config/studio.config.json"), "utf8"));
validatePaidThrough(paidThrough, Date.now(), config.timeZone);
const ledgerPath = path.join(root, "data/payout-ledger.json");
const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
const settings = await readTeamSettings(root, config, process.env.DASHBOARD_PASSWORD_OWNER);
initializePayAdjustments(config, ledger);
const employeeIds = employeeId === "all" ? config.employees.map((employee) => employee.id) : [employeeId];
for (const id of employeeIds) {
  if (!config.employees.some((employee) => employee.id === id)) throw new Error(`Unknown employee: ${id}`);
  const employee = config.employees.find(employee => employee.id === id);
  if (employee.onboarding && (!settings.employees[id] || settings.employees[id].compensation.type === "pending")) {
    if (employeeId !== "all") throw new Error("Set this employee’s pay rate before marking earnings paid.");
    continue;
  }
  const record = ledger.employees[id] ??= {};
  markEmployeeThrough(record, paidThrough);
}
await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
process.stdout.write(`Marked ${employeeId} paid through ${paidThrough}.\n`);
