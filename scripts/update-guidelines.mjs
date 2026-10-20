import { dashboardStorage } from './lib/dashboard-storage.mjs';
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readTeamSettings, teamPasswords } from "./lib/team-settings.mjs";
import { decryptPayload, encryptDashboard, normalizeRulebook } from "./lib/dashboard-data.mjs";
import { applyGuidePatch, MAX_GUIDELINE_UPDATE_BYTES } from "../lib/studio-guidelines.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const config = await readJson("config/studio.config.json");
const settings = await readTeamSettings(root, config, requiredEnvironment("DASHBOARD_PASSWORD_OWNER"));
const passwords = teamPasswords(config, settings);
const profiles = ["owner", ...config.employees.filter(e => passwords[e.id]).map(e => e.id)];

const serializedEnvelope = requiredEnvironment("STUDIO_GUIDE_ENVELOPE").trim();
if (serializedEnvelope.length > 56_000) throw new Error("Encrypted Studio Guidelines input is too large");
let submitted;
try {
  submitted = decryptPayload(JSON.parse(serializedEnvelope), passwords.owner);
} catch {
  throw new Error("Encrypted Studio Guidelines input could not be verified");
}
const serializedGuide = JSON.stringify(submitted);
if (Buffer.byteLength(serializedGuide, "utf8") > MAX_GUIDELINE_UPDATE_BYTES) throw new Error("A Studio Guidelines update must be 40 KB or smaller");
const ownerPayload = decryptPayload(await dashboardStorage(passwords.owner, "owner"), passwords.owner);
const rulebook = normalizeRulebook(submitted.mode === "patch" ? applyGuidePatch(ownerPayload.rulebook, submitted) : submitted, { updatedAt: new Date().toISOString() });

const outputs = [];
for (const id of profiles) {
  const payload = id === "owner" ? ownerPayload : decryptPayload(await dashboardStorage(passwords.owner, id), passwords[id]);
  payload.generatedAt = new Date().toISOString();
  payload.rulebook = rulebook;
  outputs.push({ id, ...encryptDashboard(payload, passwords[id]) });
}

for (const { id, ...bundle } of outputs) await dashboardStorage(passwords.owner, id, bundle);
process.stdout.write(`Updated the encrypted Studio Guidelines for ${profiles.length} dashboards with ${rulebook.entries.length} guidelines.\n`);
