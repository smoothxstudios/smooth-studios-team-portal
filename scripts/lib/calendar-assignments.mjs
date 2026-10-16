import { TEAM } from "../../lib/team-schedule.mjs";

const begin = "[Smooth Studios rental team]";
const end = "[/Smooth Studios rental team]";
const section = /(?:\n\n)?\[Smooth Studios rental team\][\s\S]*?\[\/Smooth Studios rental team\]/g;
const leadingSection = /^\[Smooth Studios rental team\][\s\S]*?\[\/Smooth Studios rental team\](?:\n\n)?/;
const isRental = title => /\bstudio(?:\s+[a-z])?\s+rental\b/i.test(title ?? "");
const teamIds = new Set(TEAM.filter(p => p.id !== "owner").map(p => p.id));

function employeeCalendarResponses(event, employees) {
  const normalize = value => typeof value === "string" ? value.trim().toLowerCase() : "";
  return employees.filter(person => teamIds.has(person.id)).flatMap(person => {
    const emails = new Set((person.invitationEmails ?? [person.email]).map(normalize).filter(Boolean));
    const responses = (event.attendees ?? []).filter(guest => emails.has(normalize(guest.email))).map(guest => guest.responseStatus);
    // An employee may use more than one configured Calendar invitation address.
    const status = ["accepted", "tentative", "needsAction"].find(value => responses.includes(value));
    return status ? [{ employeeId: person.id, status }] : [];
  });
}

export function rentalTeamDescription(description, assignments, calendarResponses = []) {
  const original = description ?? "";
  // New notes lead the description so the confirmation is visible when the
  // event opens. Strip both this format and the former appended format while
  // preserving the booking text (including its original whitespace) exactly.
  const otherNotes = original.replace(leadingSection, "").replace(section, "");
  if (otherNotes.includes(begin) || otherNotes.includes(end)) throw new Error("The rental team note markers were edited. Review the event description.");
  const people = TEAM.filter(p => teamIds.has(p.id)).flatMap(person => {
    const matches = assignments.filter(a => a.employeeId === person.id && ["pending", "accepted"].includes(a.status));
    const calendarStatus = calendarResponses.find(response => response.employeeId === person.id)?.status;
    if (matches.some(a => a.status === "accepted")) return [`✅ ${person.name} — Accepted in app`];
    if (matches.length) return [`○ ${person.name} — Awaiting app response${calendarStatus === "accepted" ? " · ✅ Accepted in Google Calendar" : ""}`];
    if (calendarStatus === "accepted") return [`✅ ${person.name} — Accepted in Google Calendar`];
    if (calendarStatus === "tentative") return [`○ ${person.name} — Tentative in Google Calendar`];
    if (calendarStatus === "needsAction") return [`○ ${person.name} — Awaiting Google Calendar response`];
    return [];
  });
  if (!people.length) return otherNotes;
  return `${begin}\n${people.join("\n")}\n${end}${otherNotes ? `\n\n${otherNotes}` : ""}`;
}

// Only the portal-owned description section is changed. Never change titles,
// prices, times, attendees, or RSVP status, and never add Calendar invitations.
export async function syncCalendarAssignmentNotes({ calendarId, accessToken, calendarEvents, rentals, assignments, employees = [], fetcher = fetch }) {
  const eligible = new Set(rentals.filter(r => r.categoryId === "studio-rentals" || isRental(r.title)).map(r => r.id));
  const report = { status: "synced", updated: 0, failed: 0, checkedAt: new Date().toISOString() };
  for (const original of calendarEvents) {
    if (original.status === "cancelled") continue;
    const candidates = assignments.filter(a => a.appointmentId === original.id && teamIds.has(a.employeeId));
    const responses = employeeCalendarResponses(original, employees);
    if ((!eligible.has(original.id) || (!candidates.some(a => ["pending", "accepted"].includes(a.status)) && !responses.length)) && !original.description?.includes(begin)) continue;
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(original.id)}`);
    url.searchParams.set("sendUpdates", "none");
    let event = original, saved = false;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const rental = eligible.has(event.id) && isRental(event.summary);
        const matching = rental ? candidates.filter(a =>
          Date.parse(a.start) === Date.parse(event.start?.dateTime) && Date.parse(a.end) === Date.parse(event.end?.dateTime)) : [];
        // Read RSVPs from the current event, including after an ETag conflict.
        // This also covers rentals that predate app assignments without creating
        // app acceptances or changing Calendar guests, payments, or payroll.
        const description = rentalTeamDescription(event.description, matching, rental ? employeeCalendarResponses(event, employees) : []);
        if (description === (event.description ?? "")) { saved = true; break; }
        if (!event.etag) throw new Error("Calendar did not supply a version for this event.");
        const response = await fetcher(url, {
          method: "PATCH", redirect: "error", signal: AbortSignal.timeout(20_000),
          headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "If-Match": event.etag },
          body: JSON.stringify({ description }),
        });
        if (response.ok) { report.updated++; saved = true; break; }
        if ([404, 410].includes(response.status)) { saved = true; break; }
        if (response.status === 403) {
          const details = await response.json().catch(() => ({}));
          const reasons = details.error?.errors?.map(e => e.reason) ?? [];
          if (!reasons.some(r => /quota|limit/i.test(r))) return { ...report, status: "needs_access", failed: report.failed + 1 };
        }
        if (response.status !== 412) throw new Error("Calendar note update did not finish.");
        // Re-read after a concurrent Calendar/Acuity edit and merge with the
        // latest description, including rechecking the appointment's time.
        const latest = await fetcher(new URL(url.pathname, url.origin), {
          redirect: "error", signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${accessToken}` },
        });
        if ([404, 410].includes(latest.status)) { saved = true; break; }
        if (!latest.ok) throw new Error("Could not refresh the changed Calendar event.");
        event = await latest.json();
        if (event.status === "cancelled") { saved = true; break; }
      }
    } catch { /* Report a retry without printing Calendar descriptions or credentials. */ }
    if (!saved) report.failed++;
  }
  if (report.failed) report.status = "retrying";
  return report;
}
