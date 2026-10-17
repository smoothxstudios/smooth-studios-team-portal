import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { teamToken, tokenHash } from "../lib/team-auth.mjs";
import { readTeamSettings, teamPasswords } from "./lib/team-settings.mjs";
import { TEAM, TEAM_API_URL } from "../lib/team-schedule.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
if (!/^[a-f0-9]{32}$/.test(accountId ?? "") || !apiToken) throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in repository Actions secrets.");
const config = JSON.parse(await readFile(path.join(root, "team-api/wrangler.jsonc"), "utf8"));
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${config.name}/secrets`;
async function secretRequest(method, data) {
  const response = await fetch(endpoint, { method, redirect: "error",
    headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(30_000) });
  const result = await response.json();
  // Never print API responses: they are not needed to diagnose status codes.
  if (!response.ok || !result.success) throw new Error(`Cloudflare secret setup failed (${response.status}). Check the account and token permissions.`);
  return result.result;
}
const studioConfig = JSON.parse(await readFile(path.join(root, "config/studio.config.json"), "utf8"));
const settings = await readTeamSettings(root, studioConfig, process.env.DASHBOARD_PASSWORD_OWNER);
const passwords = teamPasswords(studioConfig, settings);
const hashes = {};
for (const { id } of TEAM) {
  const password = passwords[id];
  if (!password && studioConfig.employees.find(e => e.id === id)?.onboarding) continue;
  if (!password || password.length < 16) throw new Error(`Missing strong dashboard password for ${id}.`);
  hashes[id] = await tokenHash(await teamToken(password, id));
}
hashes.sync = await tokenHash(await teamToken(process.env.DASHBOARD_PASSWORD_OWNER, "sync"));
const existing = await secretRequest("GET");
if (!Array.isArray(existing)) throw new Error("Could not verify existing Worker secrets. Push keys were not replaced.");
if (!existing.some(secret => secret.name === "STUDIO_REFERENCE_KEY")) {
  const keys = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  await secretRequest("PUT", { name: "STUDIO_REFERENCE_KEY", text: JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey)), type: "secret_text" });
}
if (!existing.some(secret => secret.name === "VAPID_JWK")) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  await secretRequest("PUT", { name: "VAPID_JWK", text: JSON.stringify(jwk), type: "secret_text" });
}
if (!existing.some(secret => secret.name === "CALENDAR_CONNECTION_KEY")) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  await secretRequest("PUT", { name: "CALENDAR_CONNECTION_KEY", text: Buffer.from(raw).toString("base64url"), type: "secret_text" });
}
await secretRequest("PUT", { name: "TEAM_TOKEN_HASHES", text: JSON.stringify(hashes), type: "secret_text" });

function wrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "node_modules/wrangler/bin/wrangler.js"), ...args,
      "--config", "team-api/wrangler.jsonc"], { cwd: root, stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Wrangler failed (${code}).`)));
  });
}
await wrangler(["d1", "migrations", "apply", "smooth-studios-team-db", "--remote"]);
await wrangler(["deploy"]);
// A freshly deployed Worker can briefly serve the prior version at the edge.
// Wait for the required capabilities, without weakening the readiness gate.
let ready = false;
for (let attempt = 0; attempt < 10; attempt++) {
  try {
    const health = await fetch(`${TEAM_API_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const status = health.ok && await health.json();
    ready = Boolean(status?.ready && status?.pushReady && status.version === 1 && status.availabilityVersion === 1 && status.engagementVersion === 5 && status.notificationVersion === 3 && status.creativeWorkVersion === 2 && status.studioReferenceVersion === 1 && status.payrollVersion === 1 && status.alertsVersion === 3 && status.calendarInvitationsVersion === 1 && status.calendarDeliveryVersion === 1 && status.manualNoticesVersion === 1 && status.reminderTemplatesVersion === 1 && status.dashboardLayoutVersion === 1 && status.rentalStaffVersion === 1 && status.rentalTimeVersion === 1 && status.incrementalSyncVersion === 1 && status.payrollReviewVersion === 1);
  } catch { /* A transient deployment response is retried within this bound. */ }
  if (ready) break;
  if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 2000));
}
if (!ready) throw new Error("The Worker was deployed but has not passed its readiness check. Run this deployment again before enabling scheduling.");
process.stdout.write("Team scheduling API and push keys are ready. Existing push keys were preserved.\n");

// Publish only the already-public RSA encryption key. Private imports can be
// prepared without exposing their plaintext or the Worker decryption secret.
const keyResponse = await fetch(`${TEAM_API_URL}/studio-reference/key`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
if (!keyResponse.ok) throw new Error("Could not read the secure import public key.");
const { publicKey } = await keyResponse.json();
if (publicKey?.kty !== "RSA" || typeof publicKey.n !== "string" || typeof publicKey.e !== "string") throw new Error("Invalid secure import public key.");
await mkdir(path.join(root, "public/data"), { recursive: true });
await writeFile(path.join(root, "public/data/secure-import-key.json"), JSON.stringify({ publicKey: { kty: "RSA", n: publicKey.n, e: publicKey.e, alg: "RSA-OAEP-256", key_ops: ["encrypt"], ext: true } }) + "\n");
