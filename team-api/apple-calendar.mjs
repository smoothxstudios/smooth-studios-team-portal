import { base64url, tokenHash } from "../lib/team-auth.mjs";
import { TEAM_API_URL } from "../lib/team-schedule.mjs";
import { calendarAssignments, visibleAppointments } from "./schedule-access.mjs";

const endpoint = "/calendar/apple";
const feedPath = /^\/calendar\/apple\/feed\/([A-Za-z0-9_-]{43})\.ics$/;
const active = item => ["accepted", "pending"].includes(item.status);
const utf8 = new TextEncoder();

// A distinct, read-only credential: never put the dashboard bearer in a URL.
async function subscriptionToken(bearer, nonce) {
  const key = await crypto.subtle.importKey("raw", utf8.encode(bearer), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8.encode(`smooth-apple-calendar:v1:${nonce}`))));
}
function icalText(value) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}
function fold(line) {
  let result = "", size = 0;
  for (const char of line) {
    const bytes = utf8.encode(char).length;
    if (size + bytes > 75) { result += "\r\n "; size = 1; }
    result += char; size += bytes;
  }
  return result;
}
const timestamp = value => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export async function appleCalendarDocument({ appointments, assignments, user, revision, syncedAt, createdAt }) {
  const own = assignments.filter(item => item.employeeId === user && active(item));
  const events = appointments.map(appointment => {
    const offers = own.filter(item => item.appointmentId === appointment.id);
    const accepted = user === "owner" || offers.some(item => item.status === "accepted") || appointment.acceptedEmployeeIds?.includes(user);
    return { ...appointment, key: `appointment:${appointment.id}`, 
      status: accepted ? "CONFIRMED" : "TENTATIVE",
      instructions: offers.map(item => item.instructions).filter(Boolean).join("\n\n"),
      changed: offers.map(item => item.updatedAt) };
  });
  // An appointment-backed offer is never a second event, or resurrected after
  // its source appointment was removed by the Calendar import.
  for (const item of own.filter(item => !item.appointmentId)) events.push({ ...item,
    key: `assignment:${item.id}`,  customer: "", rentalDetails: "",
    status: item.status === "accepted" ? "CONFIRMED" : "TENTATIVE", changed: [item.updatedAt] });
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Smooth Studios//Team schedule//EN", "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${user === "owner" ? "Smooth Studios" : "My Smooth Studios schedule"}`, "X-WR-TIMEZONE:America/New_York",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"];
  for (const item of events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    if (!Number.isFinite(Date.parse(item.start)) || !Number.isFinite(Date.parse(item.end)) || Date.parse(item.end) <= Date.parse(item.start)) continue;
    const changed = Math.max(...[createdAt, syncedAt, ...item.changed].map(Date.parse).filter(Number.isFinite));
    const url = "https://dashboard.smoothstudios.co/#scheduling";
    const description = [item.status === "TENTATIVE" ? "Pending response. Accept or decline in the dashboard." : "Assigned studio work.",
      item.customer && `Client: ${item.customer}`, item.rentalDetails,
      item.instructions && `Instructions: ${item.instructions}`, "Open the dashboard for the latest details and to respond.", url].filter(Boolean).join("\n\n");
    lines.push("BEGIN:VEVENT", `UID:${await tokenHash(item.key)}@dashboard.smoothstudios.co`,
      `DTSTAMP:${timestamp(changed)}`, `LAST-MODIFIED:${timestamp(changed)}`, `SEQUENCE:${revision}`,
      `DTSTART:${timestamp(item.start)}`, `DTEND:${timestamp(item.end)}`,
      `SUMMARY:${icalText(`${item.status === "TENTATIVE" ? "Pending: " : ""}${item.title}${item.customer ? ` — ${item.customer}` : ""}`)}`,
      `DESCRIPTION:${icalText(description)}`, "LOCATION:Smooth Studios", `URL:${url}`, `STATUS:${item.status}`,
      "CLASS:PRIVATE", `TRANSP:${item.status === "TENTATIVE" ? "TRANSPARENT" : "OPAQUE"}`, "END:VEVENT");
  }
  return [...lines, "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}

export async function appleCalendarFeed({ request, env, snapshot, fail }) {
  const match = new URL(request.url).pathname.match(feedPath);
  if (!match || !["GET", "HEAD"].includes(request.method)) fail(404, "Calendar subscription not found.");
  const row = await env.DB.prepare("SELECT * FROM apple_calendar_subscriptions WHERE token_hash = ?").bind(await tokenHash(match[1])).first();
  const hashes = JSON.parse(env.TEAM_TOKEN_HASHES || "{}");
  if (!row || hashes[row.user_id] !== row.credential_hash) fail(404, "Calendar subscription not found.");
  const s = await snapshot(env.DB);
  const assignments = await calendarAssignments(env.DB, s, row.user_id);
  const appointments = visibleAppointments(s, assignments, row.user_id);
  const document = request.method === "HEAD" ? null : await appleCalendarDocument({ appointments, assignments,
    user: row.user_id, revision: s.state.revision, syncedAt: s.state.synced_at, createdAt: row.created_at });
  return new Response(document, { headers: { "content-type": "text/calendar; charset=utf-8",
    "content-disposition": 'inline; filename="smooth-studios.ics"', "cache-control": "private, no-store",
    "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow, noarchive" } });
}

export async function appleCalendarRoute({ request, env, user, fail }) {
  if (new URL(request.url).pathname !== endpoint) fail(404, "Endpoint not found.");
  const db = env.DB;
  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM apple_calendar_subscriptions WHERE user_id = ?").bind(user).run();
    return { enabled: false };
  }
  if (!["GET", "POST"].includes(request.method)) fail(405, "Method not allowed.");
  const bearer = request.headers.get("authorization").slice(7), credentialHash = await tokenHash(bearer);
  let row = await db.prepare("SELECT * FROM apple_calendar_subscriptions WHERE user_id = ?").bind(user).first();
  if (request.method === "POST" && (!row || row.credential_hash !== credentialHash)) {
    const nonce = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const digest = await tokenHash(await subscriptionToken(bearer, nonce));
    // Idempotent under double taps/retries; concurrent enable requests keep the
    // first link. A changed dashboard credential invalidates the old feed.
    await db.prepare(`INSERT INTO apple_calendar_subscriptions (user_id, nonce, token_hash, credential_hash, created_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET nonce = excluded.nonce, token_hash = excluded.token_hash,
      credential_hash = excluded.credential_hash, created_at = excluded.created_at
      WHERE apple_calendar_subscriptions.credential_hash != excluded.credential_hash`)
      .bind(user, nonce, digest, credentialHash, new Date().toISOString()).run();
    row = await db.prepare("SELECT * FROM apple_calendar_subscriptions WHERE user_id = ?").bind(user).first();
  }
  if (!row || row.credential_hash !== credentialHash) return { enabled: false };
  const token = await subscriptionToken(bearer, row.nonce);
  if (await tokenHash(token) !== row.token_hash) fail(409, "Turn off Apple Calendar sync, then enable it again.");
  const url = `${TEAM_API_URL}${endpoint}/feed/${token}.ics`;
  return { enabled: true, url, subscribeUrl: url.replace(/^https:/, "webcal:") };
}
