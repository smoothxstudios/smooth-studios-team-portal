import { createSign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDashboardPayloads, decryptPayload, writeEncryptedDashboards } from "./lib/dashboard-data.mjs";
import { fetchStripeSnapshot } from "./lib/stripe-data.mjs";
import { syncTeamSchedule } from "./lib/team-api.mjs";
import { syncCalendarAssignmentNotes } from "./lib/calendar-assignments.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
const rawConfig = await readJson("config/studio.config.json");
const ledger = await readJson("data/payout-ledger.json");
const overrides = await readJson("data/payment-overrides.json");
const stripeMatches = await readJson("data/stripe-payment-matches.json");

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function googleAccessToken(serviceAccount, writeAssignments) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: writeAssignments ? "https://www.googleapis.com/auth/calendar.events" : "https://www.googleapis.com/auth/calendar.readonly",
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

function parseInvitationEmails(value, environmentName) {
  const emails = [...new Set(
    value
      .split(/[,;\r\n]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )];
  if (!emails.length || emails.some((email) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    throw new Error(`${environmentName} must contain one or more valid email addresses separated by commas`);
  }
  return emails;
}

const config = {
  ...rawConfig,
  employees: rawConfig.employees.map((employee) => {
    const invitationEmails = parseInvitationEmails(
      requiredEnvironment(employee.emailEnvironmentVariable),
      employee.emailEnvironmentVariable,
    );
    return { ...employee, email: invitationEmails[0], invitationEmails };
  }),
};

const serviceAccount = JSON.parse(requiredEnvironment("GOOGLE_SERVICE_ACCOUNT_JSON"));
const calendarId = requiredEnvironment(config.calendarIdEnvironmentVariable);
const passwords = {
  owner: requiredEnvironment("DASHBOARD_PASSWORD_OWNER"),
  ...Object.fromEntries(config.employees.map((employee) => [employee.id, requiredEnvironment(`DASHBOARD_PASSWORD_${employee.id.toUpperCase()}`)])),
};
let rulebook;
try {
  const existingOwnerEnvelope = await readJson("public/data/owner.json");
  rulebook = decryptPayload(existingOwnerEnvelope, passwords.owner).rulebook;
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw new Error("The existing owner dashboard could not be decrypted, so the Studio Guide was not overwritten", { cause: error });
  }
}
const ownerWorkflowToken = process.env.DASHBOARD_GITHUB_TOKEN?.trim();
if (!ownerWorkflowToken) {
  process.stderr.write("DASHBOARD_GITHUB_TOKEN is not configured; owner workflow controls will remain disabled.\n");
}
let teamEnabled = process.env.TEAM_API_BOOTSTRAP === "true";
try {
  teamEnabled ||= (await readJson("public/data/team-api.json")).enabled === true;
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const accessToken = await googleAccessToken(serviceAccount, teamEnabled);
const calendarEvents = await fetchCalendarEvents(calendarId, accessToken);
const stripeSecretKey = process.env.STRIPE_RESTRICTED_KEY?.trim();
const stripeSnapshot = stripeSecretKey
  ? await fetchStripeSnapshot(stripeSecretKey, { importStart: config.importStart })
  : null;
if (!stripeSnapshot) {
  process.stderr.write("STRIPE_RESTRICTED_KEY is not configured; Calendar payment fields will remain the payment source.\n");
}
const payloadOptions = {
  calendarEvents,
  config,
  ledger,
  overrides,
  stripeMatches,
  source: "google-calendar",
  ownerWorkflowToken,
  stripeSnapshot,
  rulebook,
};
let payloads = buildDashboardPayloads(payloadOptions);
if (teamEnabled) {
  const portal = await syncTeamSchedule(payloads.owner.rentals, passwords.owner);
  const calendarAssignmentSync = await syncCalendarAssignmentNotes({ calendarId, accessToken, calendarEvents,
    rentals: payloads.owner.rentals, assignments: portal.calendarAssignments });
  payloads = buildDashboardPayloads({ ...payloadOptions, portalAssignments: portal.assignments });
  // Owner-only, encrypted setup feedback. Failed note writes do not discard
  // accepted work or stop Calendar/Stripe and payroll refreshes.
  payloads.owner.calendarAssignmentSync = { ...calendarAssignmentSync,
    ...(calendarAssignmentSync.status === "needs_access" ? { serviceAccountEmail: serviceAccount.client_email } : {}) };
  process.stdout.write(`Calendar assignment notes: ${calendarAssignmentSync.status}; ${calendarAssignmentSync.updated} updated; ${calendarAssignmentSync.failed} need attention.\n`);
}
await writeEncryptedDashboards({ payloads, passwords, outputDirectory: path.join(root, "public/data"), config });
if (teamEnabled) await writeFile(path.join(root, "public/data/team-api.json"), `${JSON.stringify({ version: 1, enabled: true })}\n`);
process.stdout.write(
  `Encrypted ${calendarEvents.length} Calendar events${stripeSnapshot ? ` and ${stripeSnapshot.charges.length} Stripe payments` : ""} for ${Object.keys(payloads).length} dashboards.\n`,
);
