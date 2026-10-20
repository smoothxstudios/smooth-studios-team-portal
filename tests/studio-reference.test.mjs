import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/notification-fixture.mjs";
import worker from "../team-api/worker.mjs";
import { readFileSync } from "node:fs";
import { studioInfoEntries } from "../lib/studio-reference.mjs";

const content = () => ({ entries: [
  { id: "door", category: "Access", label: "Door", value: "synthetic-code-only", note: "Team only", kind: "secret" },
  { id: "contact", category: "Contacts", label: "Contact", value: "+1-202-555-0100", note: "", kind: "phone" },
], checklist: [{ id: "prep", phase: "Before arrival", label: "Test the lights" }, { id: "close", phase: "Closing", label: "Check for lost items" }] });
const rental = { id: "synthetic-rental", title: "Studio A Rental", customer: "Synthetic Client", priceCents: 5000,
  start: "2026-12-20T14:00:00.000Z", end: "2026-12-20T15:00:00.000Z", acceptedEmployeeIds: ["jordyn"] };
async function importCalendar(f, appointments) {
  const generation = crypto.randomUUID();
  assert.equal((await f.call("sync", "/sync/import", { generation, appointments })).status, 200);
  assert.equal((await f.call("sync", "/sync/commit", { generation, count: appointments.length })).status, 200);
}
async function setup() { const f = await fixture(); delete f.env.VAPID_JWK; return f; }
async function sealed(f, value, id = crypto.randomUUID()) {
  const pair = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  f.env.STUDIO_REFERENCE_KEY = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));
  const raw = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const b64 = data => Buffer.from(data).toString("base64url");
  return { id, wrappedKey: b64(await crypto.subtle.encrypt("RSA-OAEP", pair.publicKey, raw)), iv: b64(iv),
    ciphertext: b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`smooth-studio-reference:v1:${id}`) }, key, new TextEncoder().encode(JSON.stringify(value)))) };
}

test("private reference requires a team login and owner edits use optimistic concurrency", async () => {
  const f = await setup();
  assert.equal((await f.call("invalid", "/studio-reference")).status, 401);
  assert.equal((await f.call("sync", "/studio-reference")).status, 403);
  assert.equal((await f.call("jordyn", "/studio-reference", { ...content(), revision: 0 }, "PATCH")).status, 403);
  assert.equal((await f.call("owner", "/studio-reference", { ...content(), revision: 0 }, "PATCH")).status, 200);
  assert.equal((await f.call("rayne", "/studio-reference")).data.entries[0].value, "synthetic-code-only");
  assert.equal((await f.call("owner", "/studio-reference", { ...content(), revision: 0 }, "PATCH")).status, 409);
  const invalid = content(); invalid.entries[0] = { ...invalid.entries[0], kind: "link", value: "javascript:alert(1)" };
  assert.equal((await f.call("owner", "/studio-reference", { ...invalid, revision: 1 }, "PATCH")).status, 400);
  assert.equal((await f.call("owner", "/studio-reference", { entries: [null], checklist: [], revision: 1 }, "PATCH")).status, 400);
  f.close();
});

test("encrypted deployment import exposes only its public key and preserves later edits", async () => {
  const f = await setup(), input = await sealed(f, content());
  const response = await worker.fetch(new Request("https://api.example.invalid/studio-reference/key"), f.env, {});
  assert.equal(response.status, 200);
  const { publicKey } = await response.json();
  assert.deepEqual(Object.keys(publicKey).sort(), ["alg", "e", "ext", "key_ops", "kty", "n"]);
  assert.equal((await f.call("owner", "/sync/studio-reference", input)).status, 403);
  const tampered = { ...input, id: crypto.randomUUID() };
  assert.equal((await f.call("sync", "/sync/studio-reference", tampered)).status, 400);
  assert.equal((await f.call("sync", "/sync/studio-reference", input)).data.entries, 2);
  const changed = content(); changed.entries[0].value = "changed-synthetic-code";
  assert.equal((await f.call("owner", "/studio-reference", { ...changed, revision: 1 }, "PATCH")).status, 200);
  assert.equal((await f.call("sync", "/sync/studio-reference", input)).data.alreadyImported, true);
  assert.equal((await f.call("owner", "/studio-reference")).data.entries[0].value, "changed-synthetic-code");
  assert.equal((await f.call("sync", "/sync/studio-reference", { ...input, id: "different-import" })).status, 409);
  f.close();
});

test("rental checklists are shared only by accepted staff and the owner and survive refresh", async () => {
  const f = await setup();
  await f.call("owner", "/studio-reference", { ...content(), revision: 0 }, "PATCH");
  await importCalendar(f, [rental, { ...rental, id: "other", acceptedEmployeeIds: ["rayne"] }, { ...rental, id: "portrait", title: "Portrait session" }]);
  const rentals = (await f.call("jordyn", "/rental-checklists")).data.rentals;
  assert.equal(rentals.length, 1); assert.equal(rentals[0].id, rental.id);
  assert.equal((await f.call("owner", "/rental-checklists")).data.rentals.length, 2);
  assert.deepEqual((await f.call("akiva", "/rental-checklists")).data.rentals, []);
  const path = `/rental-checklists/${rentals[0].checklistId}`;
  const check = { action: "check", itemId: "prep", checked: true, version: 0 };
  assert.equal((await f.call("rayne", path, check, "PATCH")).status, 404);
  const results = await Promise.all([f.call("jordyn", path, check, "PATCH"), f.call("owner", path, check, "PATCH")]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const saved = (await f.call("owner", "/rental-checklists")).data.rentals.find(item => item.id === rental.id).progress;
  assert.equal(saved.version, 1); assert.ok(saved.checked.prep.at); assert.ok(["owner", "jordyn"].includes(saved.checked.prep.by));
  assert.equal((await f.call("jordyn", path, { action: "note", note: "Synthetic handoff", version: 1 }, "PATCH")).status, 200);
  assert.equal((await f.call("jordyn", path, { action: "check", itemId: "missing", checked: true, version: 2 }, "PATCH")).status, 400);
  const refreshed = (await f.call("jordyn", "/rental-checklists")).data.rentals[0];
  assert.equal(refreshed.progress.note, "Synthetic handoff"); assert.equal(refreshed.progress.version, 2);
  await importCalendar(f, [{ ...rental, start: "2026-12-21T14:00:00.000Z", end: "2026-12-21T15:00:00.000Z" }]);
  const moved = (await f.call("jordyn", "/rental-checklists")).data.rentals[0];
  assert.notEqual(moved.checklistId, rentals[0].checklistId); assert.equal(moved.progress.version, 0);
  assert.equal((await f.call("jordyn", path, { ...check, version: 2 }, "PATCH")).status, 404);
  await importCalendar(f, []);
  assert.deepEqual((await f.call("owner", "/rental-checklists")).data.rentals, []);
  f.close();
});

test("accepted app assignments grant checklist access only for the current appointment time", async () => {
  const f = await setup();
  await importCalendar(f, [{ ...rental, acceptedEmployeeIds: [] }]);
  const offer = { id: "synthetic-offer", employeeId: "amia", appointmentId: rental.id, start: rental.start, end: rental.end, status: "accepted" };
  f.DB.sqlite.prepare("INSERT INTO team_assignments (id, employee_id, data) VALUES (?, ?, ?)").run(offer.id, offer.employeeId, JSON.stringify(offer));
  assert.equal((await f.call("amia", "/rental-checklists")).data.rentals.length, 1);
  offer.status = "pending";
  f.DB.sqlite.prepare("UPDATE team_assignments SET data = ? WHERE id = ?").run(JSON.stringify(offer), offer.id);
  assert.equal((await f.call("amia", "/rental-checklists")).data.rentals.length, 0);
  f.close();
});

test("reference cleanup preserves contacts, access, Wi-Fi and every generic checklist step", async () => {
  const f = await setup();
  const legacy = content();
  legacy.entries[0].category = "Access & Wi-Fi";
  legacy.entries.push({ ...legacy.entries[0], id: "wifi", label: "Studio Wi-Fi password" });
  legacy.entries.push({ id: "price", category: "Pricing", label: "Rental price", value: "synthetic-price", kind: "text", note: "" });
  legacy.entries.push({ id: "equipment", category: "Equipment", label: "Equipment", value: "synthetic-detail", kind: "text", note: "" });
  f.DB.sqlite.prepare("UPDATE studio_reference SET data = ?, revision = 4, imported_id = 'prior-import' WHERE id = 1").run(JSON.stringify(legacy));
  const sql = readFileSync(new URL("../team-api/migrations/0013_studio_info_categories.sql", import.meta.url), "utf8");
  f.DB.sqlite.exec(sql);
  const row = f.DB.sqlite.prepare("SELECT * FROM studio_reference WHERE id = 1").get();
  const retained = JSON.parse(row.data);
  assert.deepEqual(retained.entries, studioInfoEntries(legacy.entries));
  assert.deepEqual(retained.entries.map(item => item.category), ["Access", "Contacts", "Wi-Fi"]);
  assert.deepEqual(retained.entries.map(item => item.value), legacy.entries.slice(0, 3).map(item => item.value));
  assert.deepEqual(retained.checklist, legacy.checklist);
  assert.equal(row.revision, 5); assert.equal(row.imported_id, "prior-import");
  // A stale editor cannot restore the retired sections or overwrite the migrated data.
  assert.equal((await f.call("owner", "/studio-reference", { ...legacy, revision: 4 }, "PATCH")).status, 409);
  assert.equal((await f.call("owner", "/studio-reference", { ...legacy, revision: 5 }, "PATCH")).status, 200);
  const teamView = (await f.call("amia", "/studio-reference")).data;
  assert.deepEqual(teamView.entries, retained.entries);
  assert.deepEqual(teamView.checklist, legacy.checklist);
  f.close();
});

test("BTS, Vault and trigger checklist update retains other owner-edited steps", async () => {
  const f = await setup();
  try {
    const existing = content();
    f.DB.sqlite.prepare("UPDATE studio_reference SET revision = 4, data = ? WHERE id = 1").run(JSON.stringify(existing));
    const sql = readFileSync(new URL("../team-api/migrations/0031_rental_bts_and_balance_reminders.sql", import.meta.url), "utf8");
    f.DB.sqlite.exec(sql.split("-- One receipt per rental/end/person")[0]);
    const saved = JSON.parse(f.DB.sqlite.prepare("SELECT data FROM studio_reference WHERE id = 1").get().data);
    assert.deepEqual(saved.checklist.slice(0, existing.checklist.length), existing.checklist);
    assert.deepEqual(saved.checklist.slice(-3).map(item => item.label),
      ["Record a BTS video", "Post BTS video to Content Vault", "Ask for the trigger back"]);
    assert.equal(f.DB.sqlite.prepare("SELECT revision FROM studio_reference WHERE id = 1").get().revision, 7);
  } finally { f.close(); }
});

test('checklist writes reject a concurrent staffing change within the same sync generation', async t => {
  const f = await setup(); t.after(() => f.close());
  await f.call('owner','/studio-reference',{...content(),revision:0},'PATCH');
  await importCalendar(f,[rental]);
  const item=(await f.call('jordyn','/rental-checklists')).data.rentals[0];
  const prepare=f.DB.prepare.bind(f.DB);
  f.DB.prepare=sql=>{
    if(sql.startsWith('INSERT INTO rental_checklists')) {
      f.DB.sqlite.prepare('UPDATE team_state SET revision=revision+1 WHERE id=1').run();
      f.DB.sqlite.prepare("UPDATE team_appointments SET data=json_set(data,'$.acceptedEmployeeIds',json('[]')) WHERE id=?").run(rental.id);
    }
    return prepare(sql);
  };
  const result=await f.call('jordyn',`/rental-checklists/${item.checklistId}`,{action:'check',itemId:'prep',checked:true,version:0},'PATCH');
  assert.equal(result.status,409);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM rental_checklists').get().n,0);
});
