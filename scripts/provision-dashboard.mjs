import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDashboardPayloads, generatePassword, writeEncryptedDashboards } from "./lib/dashboard-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
const rawConfig = await readJson("config/studio.config.json");
const config = {
  ...rawConfig,
  employees: rawConfig.employees.map((employee) => ({
    ...employee,
    email: `${employee.id}@preview.smoothstudios.invalid`,
  })),
};
const sample = await readJson("data/sample-calendar.json");
const ledger = await readJson("data/payout-ledger.json");
const overrides = await readJson("data/payment-overrides.json");
const privateDirectory = path.join(root, ".private");
const credentialsPath = path.join(privateDirectory, "smooth-studios-passwords.json");
const rotate = process.argv.includes("--rotate");

await mkdir(privateDirectory, { recursive: true });
let credentialFile;
try {
  credentialFile = rotate ? null : JSON.parse(await readFile(credentialsPath, "utf8"));
} catch {
  credentialFile = null;
}

if (!credentialFile) {
  const ids = ["owner", ...config.employees.map((employee) => employee.id)];
  credentialFile = {
    createdAt: new Date().toISOString(),
    warning: "Keep this file private. Distribute only each employee's own password.",
    dashboards: Object.fromEntries(ids.map((id) => [id, { password: generatePassword() }])),
  };
  await writeFile(credentialsPath, `${JSON.stringify(credentialFile, null, 2)}\n`, { mode: 0o600 });
  await chmod(credentialsPath, 0o600);
}

const passwords = Object.fromEntries(Object.entries(credentialFile.dashboards).map(([id, entry]) => [id, entry.password]));
const payloads = buildDashboardPayloads({ calendarEvents: sample.items, config, ledger, overrides, source: "sample" });
await writeEncryptedDashboards({ payloads, passwords, outputDirectory: path.join(root, "public/data"), config });
process.stdout.write(`Encrypted dashboards created. Private credentials: ${credentialsPath}\n`);
