import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
const paidThrough = args.get("through");
const employeeId = args.get("employee") ?? "all";

if (!/^\d{4}-\d{2}-\d{2}$/.test(paidThrough ?? "") || Number.isNaN(new Date(`${paidThrough}T12:00:00Z`).getTime())) {
  throw new Error("--through must be a valid YYYY-MM-DD date");
}
if (paidThrough > new Date().toISOString().slice(0, 10)) throw new Error("--through cannot be a future date");

const config = JSON.parse(await readFile(path.join(root, "config/studio.config.json"), "utf8"));
const ledgerPath = path.join(root, "data/payout-ledger.json");
const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
const employeeIds = employeeId === "all" ? config.employees.map((employee) => employee.id) : [employeeId];
for (const id of employeeIds) {
  if (!config.employees.some((employee) => employee.id === id)) throw new Error(`Unknown employee: ${id}`);
  const existing = ledger.employees[id]?.paidThrough;
  if (!existing || new Date(paidThrough) > new Date(existing)) ledger.employees[id] = { paidThrough };
}
await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
process.stdout.write(`Marked ${employeeId} paid through ${paidThrough}.\n`);
