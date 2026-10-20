import { tokenHash, unbase64url } from "../lib/team-auth.mjs";
import { studioInfoEntries } from "../lib/studio-reference.mjs";

const isRental = appointment => /studio.*rental|rental.*studio/i.test(appointment.title);
export async function studioReferenceRoute({ request, db, user, env, body, fail }) {
  const url = new URL(request.url), isOwner = user === "owner";
  const row = await db.prepare("SELECT * FROM studio_reference WHERE id = 1").first();
  if (!row) fail(503, "Studio information is waiting for its database update.");
  const reference = JSON.parse(row.data);
  const text = (value, max, required = true) => {
    if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(400, "Check the required fields and text lengths.");
    return value.trim();
  };
  const validate = value => {
    if (!value || !Array.isArray(value.entries) || value.entries.length > 200 || !Array.isArray(value.checklist) || value.checklist.length > 80) fail(400, "Check the information and checklist format.");
    const entries = value.entries.map(entry => {
      if (!entry || typeof entry !== "object") fail(400, "Check each information item.");
      if (!["text", "secret", "phone", "link"].includes(entry.kind)) fail(400, "Choose a supported information type.");
      const result = { id: text(entry.id, 80), category: text(entry.category, 80), label: text(entry.label, 160), value: text(entry.value, 6000), note: text(entry.note ?? "", 2000, false), kind: entry.kind };
      if (entry.kind === "link") { let link; try { link = new URL(result.value); } catch { fail(400, "Links must start with https://."); } if (link.protocol !== "https:" || link.username || link.password) fail(400, "Use a valid https:// link."); }
      return result;
    });
    const checklist = value.checklist.map(item => {
      if (!item || typeof item !== "object") fail(400, "Check each checklist item.");
      return { id: text(item.id, 80), phase: text(item.phase, 80), label: text(item.label, 500) };
    });
    if (new Set(entries.map(item => item.id)).size !== entries.length || new Set(checklist.map(item => item.id)).size !== checklist.length) fail(400, "Each item needs a unique ID.");
    return { entries: studioInfoEntries(entries), checklist };
  };
  if (url.pathname === "/studio-reference" && request.method === "GET") return { ...reference, entries: studioInfoEntries(reference.entries), revision: row.revision, updatedAt: row.updated_at };
  if (url.pathname === "/sync/studio-reference" && request.method === "POST") {
    if (user !== "sync") fail(403, "This import is reserved for the deployment workflow.");
    const input = await body(request);
    if (row.imported_id === input.id) return { imported: false, alreadyImported: true };
    if (row.revision !== 0) fail(409, "Studio information already exists. Update it from the owner dashboard.");
    if (!env.STUDIO_REFERENCE_KEY) fail(503, "The secure import key is not ready.");
    let value;
    try {
      const privateKey = await crypto.subtle.importKey("jwk", JSON.parse(env.STUDIO_REFERENCE_KEY), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
      const rawKey = await crypto.subtle.decrypt("RSA-OAEP", privateKey, unbase64url(input.wrappedKey));
      const aes = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64url(input.iv), additionalData: new TextEncoder().encode(`smooth-studio-reference:v1:${input.id}`) }, aes, unbase64url(input.ciphertext));
      value = JSON.parse(new TextDecoder().decode(plain));
    } catch { fail(400, "The encrypted studio reference could not be imported."); }
    const content = validate(value), now = new Date().toISOString();
    const result = await db.prepare("UPDATE studio_reference SET revision = 1, data = ?, imported_id = ?, updated_at = ? WHERE id = 1 AND revision = 0")
      .bind(JSON.stringify(content), text(input.id, 80), now).run();
    if (!result.meta.changes) fail(409, "The studio information changed. Import was not applied.");
    return { imported: true, entries: content.entries.length, checklistItems: content.checklist.length };
  }
  if (url.pathname === "/studio-reference" && request.method === "PATCH") {
    if (!isOwner) fail(403, "Only Smooth can edit studio information.");
    const input = await body(request), content = validate(input);
    if (!Number.isInteger(input.revision)) fail(400, "Refresh the studio information before editing.");
    const result = await db.prepare("UPDATE studio_reference SET revision = revision + 1, data = ?, updated_at = ? WHERE id = 1 AND revision = ?")
      .bind(JSON.stringify(content), new Date().toISOString(), input.revision).run();
    if (!result.meta.changes) fail(409, "Studio information changed. Refresh before saving your edit.");
    return { saved: true };
  }
  if (url.pathname === "/rental-checklists" || url.pathname.startsWith("/rental-checklists/")) {
    const state = await db.prepare("SELECT generation, revision FROM team_state WHERE id = 1").first();
    const appointments = (await db.prepare("SELECT data FROM team_appointments WHERE generation = ?").bind(state.generation).all()).results.map(row => JSON.parse(row.data)).filter(isRental);
    const assignments = isOwner ? [] : (await db.prepare("SELECT data FROM team_assignments WHERE employee_id = ?").bind(user).all()).results.map(row => JSON.parse(row.data));
    const allowed = appointments.filter(appointment => isOwner || appointment.acceptedEmployeeIds.includes(user) || assignments.some(item =>
      item.appointmentId === appointment.id && item.status === "accepted" && item.start === appointment.start && item.end === appointment.end));
    const rentals = await Promise.all(allowed.map(async appointment => ({ ...appointment,
      ...(isOwner ? {} : { fullyPaid: undefined, paidOnlineCents: undefined }),
      checklistId: await tokenHash(`${appointment.id}|${appointment.start}|${appointment.end}`) })));
    if (request.method === "GET" && url.pathname === "/rental-checklists") {
      const saved = (await db.prepare("SELECT id, data, version FROM rental_checklists WHERE appointment_id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(rentals.map(item => item.id))).all()).results;
      return { template: reference.checklist, rentals: rentals.map(item => { const found = saved.find(row => row.id === item.checklistId); return { ...item, progress: found ? { ...JSON.parse(found.data), version: found.version } : { version: 0, checked: {}, note: "" } }; }) };
    }
    if (request.method === "PATCH") {
      const input = await body(request), id = url.pathname.slice("/rental-checklists/".length), rental = rentals.find(item => item.checklistId === id);
      if (!rental) fail(404, "This rental is unavailable or is not assigned to you. Refresh the checklist.");
      const previous = await db.prepare("SELECT version, data FROM rental_checklists WHERE id = ?").bind(id).first();
      if (!Number.isInteger(input.version) || input.version !== (previous?.version ?? 0)) fail(409, "Someone updated this checklist. Refresh before changing it.");
      const progress = previous ? JSON.parse(previous.data) : { checked: {}, note: "" };
      const now = new Date().toISOString();
      if (input.action === "check") {
        if (typeof input.checked !== "boolean" || !reference.checklist.some(item => item.id === input.itemId)) fail(400, "Choose a valid checklist item.");
        if (input.checked) progress.checked[input.itemId] = { by: user, at: now };
        else delete progress.checked[input.itemId];
      } else if (input.action === "note") { progress.note = text(input.note, 4000, false); progress.noteBy = user; progress.noteAt = now; }
      else fail(400, "Choose a checklist action.");
      const version = input.version + 1;
      const result = await db.prepare(`INSERT INTO rental_checklists (id, appointment_id, version, data)
        SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM team_state WHERE id = 1 AND generation = ? AND revision = ?)
          AND EXISTS (SELECT 1 FROM studio_reference WHERE id = 1 AND revision = ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, version = excluded.version WHERE rental_checklists.version = ?`)
        .bind(id, rental.id, version, JSON.stringify(progress), state.generation, state.revision, row.revision, input.version).run();
      if (!result.meta.changes) fail(409, "The rental or checklist changed. Refresh before trying again.");
      return { progress: { ...progress, version } };
    }
  }
  fail(404, "Studio information endpoint not found.");
}
