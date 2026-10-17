import assert from "node:assert/strict";
import test from "node:test";
import { rentalAlertTargetId, rentalAppointmentId, safeAlertTargetId } from "../lib/alert-target.mjs";
import { base64url } from "../lib/team-auth.mjs";

test("rental destinations preserve opaque Calendar IDs without treating them as URLs", () => {
  for (const id of ["calendar-rental-fixture", "calendar:id/with.punctuation@google.com", "界".repeat(300)]) {
    const target = rentalAlertTargetId(id);
    assert.match(target, /^rental_[a-zA-Z0-9_-]+$/);
    assert.equal(rentalAppointmentId(target), id);
    assert.equal(safeAlertTargetId("notice", "scheduling", target), target);
    for (const [kind, destination] of [["schedule", "scheduling"], ["notice", "settings"], ["notice", "creative"]]) {
      assert.equal(safeAlertTargetId(kind, destination, target), null);
    }
  }
  const assignmentId = "a0000000-0000-4000-8000-000000000001";
  assert.equal(safeAlertTargetId("assignment", "scheduling", assignmentId), assignmentId);
  assert.equal(safeAlertTargetId("creative", "creative", assignmentId), assignmentId);
  assert.equal(rentalAppointmentId(assignmentId), null);
});

test("rental destination parsing rejects oversized, malformed, noncanonical and invalid UTF-8 tokens", () => {
  const oversized = `rental_${base64url(new TextEncoder().encode("a".repeat(301)))}`;
  for (const target of [null, "", "rental_", "rental_YR", "rental__w", "rental_%%%", oversized,
    `rental_${"a".repeat(1201)}`, "https://example.invalid", "javascript:bad", "bad/id"]) {
    assert.equal(rentalAppointmentId(target), null);
    assert.equal(safeAlertTargetId("notice", "scheduling", target), null);
  }
  for (const id of [null, "", "a".repeat(301), "\ud800"]) assert.equal(rentalAlertTargetId(id), null);
});
