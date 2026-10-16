import { TEAM, STUDIO_ZONE, localInstant } from "../lib/team-schedule.mjs";

const day = new Intl.DateTimeFormat("en-US", { timeZone: STUDIO_ZONE, weekday: "short", month: "short", day: "numeric" });
const clock = new Intl.DateTimeFormat("en-US", { timeZone: STUDIO_ZONE, hour: "numeric", minute: "2-digit" });
const zone = new Intl.DateTimeFormat("en-US", { timeZone: STUDIO_ZONE, timeZoneName: "short" });
const zoneName = date => zone.formatToParts(date).find(part => part.type === "timeZoneName").value;
const person = id => TEAM.find(member => member.id === id)?.name ?? "A team member";
export const notificationText = (value, limit) => typeof value === "string"
  ? Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim()).slice(0, limit).join("") : "";

export function notificationDetails(value) {
  if (!value || typeof value !== "object") return {};
  const title = notificationText(value.title, 80), body = notificationText(value.body, 360);
  return title && body ? { title, body } : {};
}

export function notificationTime(start, end) {
  const from = new Date(start), to = new Date(end);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return "Open your dashboard for the time";
  const firstZone = zoneName(from), lastZone = zoneName(to);
  if (day.format(from) !== day.format(to)) return `${day.format(from)}, ${clock.format(from)} ${firstZone}–${day.format(to)}, ${clock.format(to)} ${lastZone}`;
  return `${day.format(from)} · ${clock.format(from)}${firstZone !== lastZone ? ` ${firstZone}` : ""}–${clock.format(to)} ${lastZone}`;
}

export function assignmentNotifications(item, event, recipients) {
  const type = item.appointmentId ? "rental" : "task", name = person(item.employeeId);
  const detail = `${notificationText(item.title, 120)} · ${notificationTime(item.start, item.end)}.`;
  return [...new Set(recipients)].map(userId => {
    const owner = userId === "owner";
    const content = {
      offered: { title: `New ${type} assignment`, body: `${detail} Tap to accept or decline.` },
      accepted: { title: `${name} accepted a ${type}`, body: detail },
      declined: { title: `${name} declined a ${type}`, body: `${detail} Choose another team member.` },
      cancelled: { title: `${type === "rental" ? "Rental" : "Task"} assignment cancelled`, body: detail },
      conflict: { title: "Time conflict approved", body: `${detail} Smooth approved the conflict. Tap to review your offer.` },
      rescheduled: { title: owner ? `${name}’s ${type} time changed` : `${type === "rental" ? "Rental" : "Task"} time changed`, body: `${detail} ${owner ? "A new acceptance is needed." : "Tap to accept the new time."}` },
      removed: { title: owner ? `${name}’s rental was cancelled` : "Rental removed from Calendar", body: `${detail} The assignment is cancelled.` },
      past: { title: "Changed rental needs review", body: `${name} · ${detail} The assignment was cancelled because the new time is in the past.` },
    }[event];
    if (!content) throw new Error("Unsupported assignment notification.");
    return { userId, kind: event === "offered" ? "assignment" : "schedule", ...notificationDetails(content), target: "scheduling", targetId: item.id };
  });
}

export function blockNotifications(item, removed, recipients) {
  const time = notificationTime(localInstant(item.startLocal), localInstant(item.endLocal));
  const repeat = item.repeatUntil ? ` Repeats weekly through ${day.format(new Date(localInstant(`${item.repeatUntil}T12:00`)))}.` : "";
  return [...new Set(recipients)].map(userId => ({ userId, kind: "schedule",
    title: userId === "owner" ? `${person(item.userId)} ${removed ? "removed a time block" : "blocked time"}` : `Time block ${removed ? "removed" : "added"}`,
    body: `${time}.${repeat} Open your schedule to review.`, target: "availability",
  }));
}
