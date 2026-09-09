import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decryptPayload, encryptPayload, normalizeRulebook } from "./lib/dashboard-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const config = await readJson("config/studio.config.json");
const profiles = ["owner", ...config.employees.map((employee) => employee.id)];
const passwords = Object.fromEntries(profiles.map((id) => {
  const password = requiredEnvironment(`DASHBOARD_PASSWORD_${id.toUpperCase()}`);
  if (password.length < 16) throw new Error(`Missing strong password for ${id}`);
  return [id, password];
}));

const serializedEnvelope = requiredEnvironment("STUDIO_GUIDE_ENVELOPE").trim();
if (serializedEnvelope.length > 56_000) throw new Error("Encrypted Studio Guide input is too large");
let submitted;
try {
  submitted = decryptPayload(JSON.parse(serializedEnvelope), passwords.owner);
} catch {
  throw new Error("Encrypted Studio Guide input could not be verified");
}
const serializedGuide = JSON.stringify(submitted);
if (Buffer.byteLength(serializedGuide, "utf8") > 40_000) throw new Error("Studio Guide must be 40 KB or smaller");
const rulebook = normalizeRulebook(submitted, { updatedAt: new Date().toISOString() });

const outputs = [];
for (const id of profiles) {
  const relativePath = `public/data/${id}.json`;
  const payload = decryptPayload(await readJson(relativePath), passwords[id]);
  payload.rulebook = rulebook;
  outputs.push({ relativePath, envelope: encryptPayload(payload, passwords[id]) });
}

await Promise.all(outputs.map(({ relativePath, envelope }) =>
  writeFile(path.join(root, relativePath), `${JSON.stringify(envelope)}\n`, "utf8"),
));
process.stdout.write(`Updated the encrypted Studio Guide for ${profiles.length} dashboards with ${rulebook.entries.length} guidelines.\n`);
