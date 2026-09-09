export const TEAM_API_URL = "https://smooth-studios-team-api.smoothxstudios.workers.dev";
export const STUDIO_ZONE = "America/New_York";
export const TEAM = [
  { id: "owner", name: "Smooth", color: "#171719" },
  { id: "akiva", name: "Akiva", color: "rgb(225, 0, 0)" },
  { id: "jordyn", name: "Jordyn", color: "rgb(37, 99, 235)" },
  { id: "rayne", name: "Rayne", color: "rgb(147, 51, 234)" },
];
const dayMs = 86_400_000;
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: STUDIO_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function studioLocal(value) {
  const p = Object.fromEntries(formatter.formatToParts(new Date(value)).map(v => [v.type, v.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function localInstant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Choose a valid date and time.");
  const target = Date.parse(`${value}Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 16) !== value) throw new Error("Choose a valid date and time.");
  let candidate = target + 4 * 3600_000;
  for (let i = 0; i < 3; i++) {
    const difference = target - Date.parse(`${studioLocal(candidate)}Z`);
    if (!difference) return new Date(candidate).toISOString();
    candidate += difference;
  }
  throw new Error("That time does not exist during the daylight-saving change. Choose another time.");
}

export function addLocalDays(value, days) {
  return new Date(Date.parse(`${value}Z`) + days * dayMs).toISOString().slice(0, 16);
}

export function overlaps(a, b) {
  return Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
}

export function hasConflictOverride(assignment) {
  const approval = assignment.conflictOverride;
  return Boolean(approval?.approvedBy === "owner" &&
    Date.parse(approval.start) === Date.parse(assignment.start) &&
    Date.parse(approval.end) === Date.parse(assignment.end));
}

export function blockOccurrences(block, from, to) {
  const occurrences = [];
  const count = block.repeatUntil ? Math.min(53, Math.floor((Date.parse(`${block.repeatUntil}T23:59Z`) - Date.parse(`${block.startLocal}Z`)) / (7 * dayMs)) + 1) : 1;
  // Only materialize nearby weeks. This keeps one-hour conflict checks cheap
  // even when the team has many year-long class schedules. The extra day on
  // either side covers timezone offsets and an overnight block.
  const anchor = Date.parse(`${block.startLocal}Z`);
  const firstWeek = block.repeatUntil ? Math.max(0, Math.floor((Date.parse(from) - anchor - 2 * dayMs) / (7 * dayMs))) : 0;
  const lastWeek = block.repeatUntil ? Math.min(count - 1, Math.ceil((Date.parse(to) - anchor + dayMs) / (7 * dayMs))) : 0;
  for (let week = firstWeek; week <= lastWeek; week++) {
    let start, end;
    try {
      start = localInstant(addLocalDays(block.startLocal, week * 7));
      end = localInstant(addLocalDays(block.endLocal, week * 7));
    } catch { continue; } // Creation validates every occurrence; defensive on old records.
    if (overlaps({ start, end }, { start: from, end: to })) occurrences.push({ ...block, start, end });
  }
  return occurrences;
}

export function assignmentConflicts(employeeId, period, blocks, assignments, appointments, excludeId = "") {
  const conflicts = [];
  for (const block of blocks.filter(b => b.userId === employeeId)) {
    if (blockOccurrences(block, period.start, period.end).length) conflicts.push(`Blocked: ${block.reason}`);
  }
  for (const item of assignments.filter(a => a.employeeId === employeeId && a.id !== excludeId && ["pending", "accepted"].includes(a.status))) {
    if (overlaps(period, item)) conflicts.push(`Assignment: ${item.title}`);
  }
  for (const item of appointments.filter(a => a.id !== period.appointmentId && a.acceptedEmployeeIds.includes(employeeId))) {
    if (overlaps(period, item)) conflicts.push(`Calendar: ${item.title}`);
  }
  return conflicts;
}
