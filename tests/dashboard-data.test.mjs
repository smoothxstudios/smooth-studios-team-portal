import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import {
  buildDashboardPayloads,
  encryptPayload,
  normalizeCalendarEvent,
  parseCalendarDescription,
  parseMoneyToCents,
} from "../scripts/lib/dashboard-data.mjs";

const config = {
  importStart: "2026-01-01T00:00:00-05:00",
  calendarName: "Smooth Studios",
  commissionRate: 0.3,
  owner: { name: "Smooth Studios" },
  employees: [
    { id: "akiva", name: "Akiva", email: "akiva@example.invalid", invitationEmails: ["akiva@example.invalid", "akiva.alias@example.invalid"], accent: "#e10000" },
    { id: "jordyn", name: "Jordyn", email: "jordyn@example.invalid", accent: "#202024" },
    { id: "rayne", name: "Rayne", email: "rayne@example.invalid", accent: "#b21f2d" },
  ],
};
const ledger = { employees: {} };

const event = {
  id: "calendar-event-1",
  status: "confirmed",
  summary: "Example Customer: Studio Rental (Smooth Studios)",
  start: { dateTime: "2026-08-28T18:00:00-04:00" },
  end: { dateTime: "2026-08-28T19:00:00-04:00" },
  description: `August 28, 2026 6:00pm EDT
Calendar: Smooth Studios
Name: Example Customer
Phone: +10000000000
Email: customer@example.invalid
Price: $50.00
Paid Online: $50.00

Studio Rental Form
============
What type of photoshoot are you doing?:

AcuityID=1761525698`,
  attendees: [
    { email: "akiva@example.invalid", responseStatus: "accepted" },
    { email: "jordyn@example.invalid", responseStatus: "declined" },
  ],
};

test("parses the exact Calendar description fields", () => {
  const parsed = parseCalendarDescription(event.description);
  assert.equal(parsed.name, "Example Customer");
  assert.equal(parsed.priceCents, 5000);
  assert.equal(parsed.paidOnlineCents, 5000);
  assert.equal(parsed.acuityId, "1761525698");
  assert.equal(parseMoneyToCents("$1,250.50"), 125050);
});

test("assigns only accepted employees and gives each the full 30 percent", () => {
  const normalized = normalizeCalendarEvent(event, config, ledger, {});
  assert.deepEqual(normalized.assignedEmployeeIds, ["akiva"]);
  assert.equal(normalized.employeePayouts.akiva.amountCents, 1500);
  assert.equal(normalized.employeePayouts.jordyn, undefined);

  const bothAccepted = {
    ...event,
    attendees: event.attendees.map((attendee) => ({ ...attendee, responseStatus: "accepted" })),
  };
  const shared = normalizeCalendarEvent(bothAccepted, config, ledger, {});
  assert.equal(shared.employeePayouts.akiva.amountCents, 1500);
  assert.equal(shared.employeePayouts.jordyn.amountCents, 1500);
});

test("assigns an employee through any accepted invitation email", () => {
  const aliasAccepted = {
    ...event,
    attendees: [{ email: "AKIVA.ALIAS@example.invalid", responseStatus: "accepted" }],
  };
  const normalized = normalizeCalendarEvent(aliasAccepted, config, ledger, {});
  assert.deepEqual(normalized.assignedEmployeeIds, ["akiva"]);
  assert.equal(normalized.employeePayouts.akiva.amountCents, 1500);
});

test("requires an exact payment match unless the owner overrides it", () => {
  const partial = { ...event, description: event.description.replace("Paid Online: $50.00", "Paid Online: $49.99") };
  assert.equal(normalizeCalendarEvent(partial, config, ledger, {}).fullyPaid, false);
  const overridden = normalizeCalendarEvent(partial, config, ledger, { "calendar-event-1": true });
  assert.equal(overridden.fullyPaid, true);
  assert.equal(overridden.paymentOverride, true);
});

test("never marks commission paid before the rental is complete", () => {
  const futureEvent = {
    ...event,
    id: "future-event",
    start: { dateTime: "2099-08-28T18:00:00-04:00" },
    end: { dateTime: "2099-08-28T19:00:00-04:00" },
  };
  const futureLedger = { employees: { akiva: { paidThrough: "2099-12-31" } } };
  const normalized = normalizeCalendarEvent(futureEvent, config, futureLedger, {});
  assert.equal(normalized.employeePayouts.akiva.paid, false);
});

test("employee payloads contain only their own accepted rentals and payout", () => {
  const payloads = buildDashboardPayloads({
    calendarEvents: [event],
    config,
    ledger,
    overrides: { events: {} },
    source: "google-calendar",
  });
  assert.equal(payloads.owner.rentals.length, 1);
  assert.equal(payloads.akiva.rentals.length, 1);
  assert.equal(payloads.jordyn.rentals.length, 0);
  assert.deepEqual(Object.keys(payloads.akiva.rentals[0].employeePayouts), ["akiva"]);
  assert.equal(payloads.owner.employees[0].invitationEmails, undefined);
});

test("AES-GCM envelope decrypts with the correct password", async () => {
  const original = { private: "dashboard payload", amount: 1500 };
  const envelope = encryptPayload(original, "correct horse battery studio");
  const passwordKey = await webcrypto.subtle.importKey("raw", new TextEncoder().encode("correct horse battery studio"), "PBKDF2", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: Buffer.from(envelope.salt, "base64"), iterations: envelope.iterations }, passwordKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plaintext = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(envelope.iv, "base64") }, key, Buffer.from(envelope.ciphertext, "base64"));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plaintext)), original);
});
