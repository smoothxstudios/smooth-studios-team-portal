import test from "node:test";
import assert from "node:assert/strict";
import worker from "../team-api/worker.mjs";
import { fixture } from "./helpers/notification-fixture.mjs";
import { teamToken, tokenHash } from "../lib/team-auth.mjs";
import { appleCalendarDocument } from "../team-api/apple-calendar.mjs";

const booking = (id, employeeIds = []) => ({ id, title: `Rental ${id}`, customer: `Client ${id}`,
  start: "2026-11-01T01:30:00-04:00", end: "2026-11-01T02:30:00-05:00", priceCents: 12345,
  paidOnlineCents: 9876, fullyPaid: true, acceptedEmployeeIds: employeeIds, rentalDetails: `Backdrop: white for ${id}` });
function seed(f, appointments, assignments = []) {
  f.DB.sqlite.prepare("UPDATE team_state SET generation = 'apple-test', revision = revision + 1, synced_at = ? WHERE id = 1").run(new Date().toISOString());
  const insert = f.DB.sqlite.prepare("INSERT OR REPLACE INTO team_appointments(generation,id,data) VALUES('apple-test',?,?)");
  for (const appointment of appointments) insert.run(appointment.id, JSON.stringify(appointment));
  for (const item of assignments) f.DB.sqlite.prepare("INSERT OR REPLACE INTO team_assignments(id,employee_id,data) VALUES(?,?,?)").run(item.id, item.employeeId, JSON.stringify(item));
}
const assignment = (id, appointmentId, employeeId = "jordyn", status = "pending") => ({ id, appointmentId, employeeId,
  title: `Task ${id}`, instructions: `Instructions for ${employeeId}`, status,
  start: "2026-11-01T05:30:00Z", end: "2026-11-01T07:30:00Z", createdAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T11:00:00Z" });
async function feed(f, url, method = "GET") {
  const response = await worker.fetch(new Request(url, { method }), f.env, { waitUntil: promise => f.pending.push(promise) });
  return { response, text: (await response.text()).replace(/\r\n /g, "") };
}
const enable = async (f, user = "jordyn") => { const result = await f.call(user, "/calendar/apple", {}); assert.equal(result.status, 200); return result.data; };
const setup = async t => { const f = await fixture(); delete f.env.VAPID_JWK; t.after(async () => { await Promise.allSettled(f.pending); f.close(); }); return f; };

test("Apple sync is opt-in, scoped, idempotent and stores no raw link or dashboard bearer", async t => {
  const f = await setup(t);
  assert.deepEqual((await f.call("jordyn", "/calendar/apple")).data, { enabled: false });
  assert.equal((await f.call("sync", "/calendar/apple", {})).status, 403);
  assert.equal((await f.call("unknown", "/calendar/apple", {})).status, 401);
  const a = await enable(f), b = await enable(f);
  assert.equal(a.url, b.url);
  assert.deepEqual((await f.call("jordyn", "/calendar/apple")).data, a);
  assert.equal(a.subscribeUrl, a.url.replace("https:", "webcal:"));
  const raw = a.url.split("/").pop().slice(0, -4), row = f.DB.sqlite.prepare("SELECT * FROM apple_calendar_subscriptions WHERE user_id='jordyn'").get();
  assert.equal(row.token_hash, await tokenHash(raw));
  assert.ok(!JSON.stringify(row).includes(raw));
  const bearer = await teamToken("synthetic-notification-tests-jordyn", "jordyn");
  assert.notEqual(bearer, raw);
  assert.equal((await worker.fetch(new Request("https://api.example.invalid/schedule", { headers: { authorization: `Bearer ${raw}` } }), f.env, {})).status, 401);
  assert.equal((await f.call("rayne", "/calendar/apple")).data.enabled, false);
});

test("Personal feed includes only assigned work, combines Google and app invitations, and is read-only", async t => {
  const f = await setup(t);
  seed(f, [booking("mine", ["jordyn"]), booking("private-rayne", ["rayne"]), booking("unassigned"),
    { ...booking("google-pending"), calendarInvitations: [{ employeeId: "jordyn", status: "needsAction" }] }],
    [assignment("mine-offer", "mine"), assignment("own-task", null), assignment("private-task", null, "rayne"), assignment("removed-task", null, "jordyn", "cancelled")]);
  const link = await enable(f), revision = (await f.call("jordyn", "/schedule")).data.revision;
  const { response, text } = await feed(f, link.url);
  assert.equal(response.status, 200);
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.match(text, /Rental mine/); assert.match(text, /Pending: Rental google-pending/); assert.match(text, /Task own-task/);
  assert.doesNotMatch(text, /private-rayne|private-task|removed-task|unassigned|9876|12345|fullyPaid|paidOnlineCents/);
  assert.match(text, /Instructions for jordyn/); assert.doesNotMatch(text, /Instructions for rayne/);
  assert.match(text, /DTSTART:20261101T053000Z/); assert.match(text, /DTEND:20261101T073000Z/);
  assert.equal((await f.call("jordyn", "/schedule")).data.revision, revision);
  assert.equal(JSON.parse(f.DB.sqlite.prepare("SELECT data FROM team_assignments WHERE id='mine-offer'").get().data).status, "pending");
  assert.match(response.headers.get("content-type"), /text\/calendar/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  assert.equal((await feed(f, link.url, "HEAD")).text, "");
});

test("Time changes keep the same UID; removed rentals and cancelled standalone work disappear", async t => {
  const f = await setup(t), item = booking("extended", ["jordyn"]);
  seed(f, [item], [assignment("task", null, "jordyn", "accepted")]);
  const link = await enable(f), original = (await feed(f, link.url)).text;
  const originalUid = original.match(/UID:([^\r]+)/)[1];
  seed(f, [{ ...item, end: "2026-11-01T08:30:00Z" }]);
  const updated = (await feed(f, link.url)).text;
  assert.equal(updated.match(/UID:([^\r]+)/)[1], originalUid);
  assert.match(updated, /DTEND:20261101T083000Z/);
  assert.ok(Number(updated.match(/SEQUENCE:(\d+)/)[1]) > Number(original.match(/SEQUENCE:(\d+)/)[1]));
  f.DB.sqlite.prepare("DELETE FROM team_appointments WHERE id='extended'").run();
  seed(f, [], [assignment("task", null, "jordyn", "cancelled")]);
  assert.doesNotMatch((await feed(f, link.url)).text, /BEGIN:VEVENT/);
});

test("Explicit staff removal hides stale Google invitations, later verified re-invitations reappear", async t => {
  const f = await setup(t), item = booking("removed", ["jordyn"]), removed = { ...assignment("removal", item.id, "jordyn", "cancelled"), removeCalendarGuest: true };
  seed(f, [item], [removed]);
  const link = await enable(f);
  assert.doesNotMatch((await feed(f, link.url)).text, /Rental removed/);
  f.DB.sqlite.prepare("INSERT INTO calendar_assignment_outbox(assignment_id,version,status,result,updated_at) VALUES(?,?,?,?,?)").run("removal", "test", "synced", JSON.stringify({ code: "person_removed" }), Date.parse("2026-10-01"));
  assert.match((await feed(f, link.url)).text, /Rental removed/);
});

test("Disabling or rotating dashboard credentials revokes the old link; employee cannot disable others", async t => {
  const f = await setup(t), mine = await enable(f), other = await enable(f, "rayne");
  assert.equal((await f.call("jordyn", "/calendar/apple", undefined, "DELETE")).status, 200);
  assert.equal((await feed(f, mine.url)).response.status, 404);
  assert.equal((await feed(f, other.url)).response.status, 200);
  const fresh = await enable(f); assert.notEqual(fresh.url, mine.url);
  const hashes = JSON.parse(f.env.TEAM_TOKEN_HASHES); hashes.jordyn = "replaced-credential"; f.env.TEAM_TOKEN_HASHES = JSON.stringify(hashes);
  assert.equal((await feed(f, fresh.url)).response.status, 404);
  assert.equal((await feed(f, other.url)).response.status, 200);
  delete hashes.rayne; f.env.TEAM_TOKEN_HASHES = JSON.stringify(hashes);
  assert.equal((await feed(f, other.url)).response.status, 404);
});

test("Feed rejects malformed, wrong, or write requests without exposing data", async t => {
  const f = await setup(t), link = await enable(f);
  assert.equal((await feed(f, link.url, "POST")).response.status, 404);
  assert.equal((await feed(f, link.url, "DELETE")).response.status, 404);
  assert.equal((await feed(f, link.url.replace(/[^/]+\.ics$/, "invalid.ics"))).response.status, 404);
  assert.equal((await feed(f, link.url.replace(/[^/]+\.ics$/, "A".repeat(43) + ".ics"))).response.status, 404);
});

test("Owner feed contains all studio appointments without another employee’s standalone instructions", async t => {
  const f = await setup(t);
  seed(f, [booking("one"), booking("two", ["rayne"])], [assignment("private-task", null, "rayne")]);
  const text = (await feed(f, (await enable(f, "owner")).url)).text;
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(text, /X-WR-CALNAME:Smooth Studios/); assert.doesNotMatch(text, /private-task|Instructions for rayne/);
});

test("iCalendar escapes injected lines, folds UTF-8 at 75 octets, and preserves overnight UTC instants", async () => {
  const item = { ...booking("safe", ["jordyn"]), title: 'Rental, lights; \\ props ' + "🎥é".repeat(40),
    rentalDetails: "Setup\r\nEND:VEVENT\nBEGIN:VEVENT\rSUMMARY:injected", start: "2026-10-20T23:00:00-04:00", end: "2026-10-21T02:00:00-04:00" };
  const text = await appleCalendarDocument({ appointments: [item], assignments: [], user: "jordyn", revision: 5, syncedAt: "2026-10-20T10:00:00Z", createdAt: "2026-10-20T10:00:00Z" });
  for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75);
  const unfolded = text.replace(/\r\n /g, "");
  assert.equal((unfolded.match(/\r\nBEGIN:VEVENT\r\n/g) || []).length, 1);
  assert.match(unfolded, /Rental\\, lights\\; \\\\ props/);
  assert.match(unfolded, /Setup\\nEND:VEVENT\\nBEGIN:VEVENT\\nSUMMARY:injected/);
  assert.match(unfolded, /DTSTART:20261021T030000Z\r\nDTEND:20261021T060000Z/);
  assert.ok(unfolded.endsWith("END:VCALENDAR\r\n"));
  assert.doesNotMatch(unfolded, /\uFFFD|ATTENDEE|ORGANIZER|METHOD:REQUEST/);
});
