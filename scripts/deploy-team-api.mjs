import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { teamToken, tokenHash } from "../lib/team-auth.mjs";
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
const hashes = {};
for (const { id } of TEAM) {
  const password = process.env[`DASHBOARD_PASSWORD_${id.toUpperCase()}`];
  if (!password || password.length < 16) throw new Error(`Missing strong dashboard password for ${id}.`);
  hashes[id] = await tokenHash(await teamToken(password, id));
}
hashes.sync = await tokenHash(await teamToken(process.env.DASHBOARD_PASSWORD_OWNER, "sync"));
const existing = await secretRequest("GET");
if (!Array.isArray(existing)) throw new Error("Could not verify existing Worker secrets. Push keys were not replaced.");
if (!existing.some(secret => secret.name === "VAPID_JWK")) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  await secretRequest("PUT", { name: "VAPID_JWK", text: JSON.stringify(jwk), type: "secret_text" });
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
const health = await fetch(`${TEAM_API_URL}/health`, { signal: AbortSignal.timeout(30_000) });
const status = health.ok && await health.json();
if (!status?.ready || !status?.pushReady || status.version !== 1) throw new Error("The Worker was deployed but has not passed its readiness check. Run this deployment again before enabling scheduling.");
process.stdout.write("Team scheduling API and push keys are ready. Existing push keys were preserved.\n");
