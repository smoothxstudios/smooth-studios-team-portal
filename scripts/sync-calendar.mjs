import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDashboardPayloads, writeEncryptedDashboards } from "./lib/dashboard-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
const rawConfig = await readJson("config/studio.config.json");
const ledger = await readJson("data/payout-ledger.json");
const overrides = await readJson("data/payment-overrides.json");

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function googleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(serviceAccount.private_key).toString("base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`Google token request failed (${response.status})`);
  const data = await response.json();
  return data.access_token;
}

async function fetchCalendarEvents(calendarId, accessToken) {
  const items = [];
  let pageToken = null;
  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("timeMin", new Date(config.importStart).toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "2500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Google Calendar request failed (${response.status})`);
    const page = await response.json();
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? null;
  } while (pageToken);
  return items;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const config = {
  ...rawConfig,
  employees: rawConfig.employees.map((employee) => ({
    ...employee,
    email: requiredEnvironment(employee.emailEnvironmentVariable),
  })),
};

const serviceAccount = JSON.parse(requiredEnvironment("GOOGLE_SERVICE_ACCOUNT_JSON"));
const calendarId = requiredEnvironment(config.calendarIdEnvironmentVariable);
const passwords = {
  owner: requiredEnvironment("DASHBOARD_PASSWORD_OWNER"),
  ...Object.fromEntries(config.employees.map((employee) => [employee.id, requiredEnvironment(`DASHBOARD_PASSWORD_${employee.id.toUpperCase()}`)])),
};
const accessToken = await googleAccessToken(serviceAccount);
const calendarEvents = await fetchCalendarEvents(calendarId, accessToken);
const payloads = buildDashboardPayloads({ calendarEvents, config, ledger, overrides, source: "google-calendar" });
await writeEncryptedDashboards({ payloads, passwords, outputDirectory: path.join(root, "public/data"), config });
process.stdout.write(`Encrypted ${calendarEvents.length} Calendar events for ${Object.keys(payloads).length} dashboards.\n`);
