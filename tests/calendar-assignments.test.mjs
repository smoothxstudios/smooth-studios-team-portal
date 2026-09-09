import assert from "node:assert/strict";
import test from "node:test";
import { rentalTeamDescription, syncCalendarAssignmentNotes } from "../scripts/lib/calendar-assignments.mjs";

const original = "<b>Booking details</b>\nPrice: $100.00\nPaid Online: $25.00\nBackdrop: Blue\n";
const event = { id: "synthetic-rental", summary: "Synthetic Customer: Studio A Rental", description: original, etag: '"v1"',
  start: { dateTime: "2026-10-05T13:00:00Z" }, end: { dateTime: "2026-10-05T14:00:00Z" },
  attendees: [{ email: "fixture@example.invalid", responseStatus: "accepted" }] };
const pending = { appointmentId: event.id, employeeId: "jordyn", status: "pending", start: event.start.dateTime, end: event.end.dateTime };
const rentals = [{ id: event.id, title: "Studio A Rental", categoryId: "other" }];
const args = { calendarId: "synthetic-calendar@example.invalid", accessToken: "synthetic-test-only", calendarEvents: [event], rentals, assignments: [pending] };

test("team notes preserve booking text exactly and distinguish an offer from acceptance", () => {
  const offer = rentalTeamDescription(original, [pending, pending]);
  assert.ok(offer.startsWith(original));
  assert.equal((offer.match(/Jordyn/g) ?? []).length, 1);
  assert.match(offer, /awaiting response/);
  const accepted = rentalTeamDescription(offer, [{ ...pending, status: "accepted" }]);
  assert.match(accepted, /Jordyn — Accepted/);
  assert.doesNotMatch(accepted, /awaiting response/);
  assert.equal(rentalTeamDescription(accepted, [{ ...pending, status: "cancelled" }]), original);
  assert.equal(rentalTeamDescription(offer, [{ ...pending, status: "declined" }]), original);
  assert.equal(rentalTeamDescription(accepted, [{ ...pending, status: "accepted" }]), accepted);
});
test("writeback patches only rental descriptions, suppresses notifications, and skips repeat writes", async () => {
  let patched;
  const result = await syncCalendarAssignmentNotes({ ...args, fetcher: async (url, options) => {
    assert.equal(url.searchParams.get("sendUpdates"), "none");
    assert.equal(options.method, "PATCH");
    assert.equal(options.headers["If-Match"], event.etag);
    assert.equal(options.redirect, "error");
    const data = JSON.parse(options.body);
    assert.deepEqual(Object.keys(data), ["description"]);
    patched = data.description;
    return new Response("{}", { status: 200 });
  } });
  assert.equal(result.updated, 1);
  assert.equal(result.status, "synced");
  const second = await syncCalendarAssignmentNotes({ ...args, calendarEvents: [{ ...event, description: patched }], fetcher: async () => assert.fail("Unchanged notes should not be patched") });
  assert.equal(second.updated, 0);
  await syncCalendarAssignmentNotes({ ...args, calendarEvents: [{ ...event, summary: "Studio Photoshoot" }], rentals: [{ ...rentals[0], title: "Studio Photoshoot" }], fetcher: async () => assert.fail("Other appointment types must not be patched") });
  await syncCalendarAssignmentNotes({ ...args, assignments: [{ ...pending, appointmentId: null }], fetcher: async () => assert.fail("Custom tasks must not write to Calendar") });
});
test("concurrent Calendar edits are preserved when the version changes", async () => {
  let calls = 0;
  const result = await syncCalendarAssignmentNotes({ ...args, fetcher: async (_url, options) => {
    calls++;
    if (calls === 1) return new Response(null, { status: 412 });
    if (calls === 2) {
      assert.equal(options.method, undefined);
      return Response.json({ ...event, etag: '"v2"', description: `${original}Client added a note.` });
    }
    assert.equal(options.headers["If-Match"], '"v2"');
    assert.ok(JSON.parse(options.body).description.startsWith(`${original}Client added a note.`));
    return Response.json({});
  } });
  assert.equal(calls, 3);
  assert.equal(result.updated, 1);
});
test("a concurrently moved event does not receive acceptance for its old time", async () => {
  let calls = 0;
  const result = await syncCalendarAssignmentNotes({ ...args, assignments: [{ ...pending, status: "accepted" }], fetcher: async () => {
    calls++;
    if (calls === 1) return new Response(null, { status: 412 });
    if (calls === 2) return Response.json({ ...event, etag: '"v2"', start: { dateTime: "2026-10-06T13:00:00Z" }, end: { dateTime: "2026-10-06T14:00:00Z" } });
    assert.fail("Old-time acceptance must not be applied to the new time");
  } });
  assert.equal(result.updated, 0);
  assert.equal(result.status, "synced");
});
test("cancelled offers remove only the portal note; permission and quota problems remain retryable", async () => {
  const description = rentalTeamDescription(original, [{ ...pending, status: "accepted" }]);
  const result = await syncCalendarAssignmentNotes({ ...args, calendarEvents: [{ ...event, description }], assignments: [{ ...pending, status: "cancelled" }], fetcher: async (_url, options) => {
    assert.equal(JSON.parse(options.body).description, original);
    return Response.json({});
  } });
  assert.equal(result.updated, 1);
  const denied = await syncCalendarAssignmentNotes({ ...args, fetcher: async () => Response.json({ error: { errors: [{ reason: "forbidden" }] } }, { status: 403 }) });
  assert.equal(denied.status, "needs_access");
  const limited = await syncCalendarAssignmentNotes({ ...args, fetcher: async () => Response.json({ error: { errors: [{ reason: "rateLimitExceeded" }] } }, { status: 403 }) });
  assert.equal(limited.status, "retrying");
  const failed = await syncCalendarAssignmentNotes({ ...args, fetcher: async () => { throw new Error("Network unavailable"); } });
  assert.equal(failed.status, "retrying");
});
