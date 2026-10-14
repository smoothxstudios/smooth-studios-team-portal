export const MAX_GUIDELINES = 200;
export const MAX_GUIDELINE_UPDATE_BYTES = 40_000;

const CATEGORY_NAMES = {
  "Before the rental": "Rental preparation",
  "During the rental": "Client experience",
  "After the rental": "Cleaning & supplies",
  Equipment: "Equipment & lighting",
  "Customer care": "Client experience",
  Emergencies: "Safety & incidents",
};
export function generalGuidelineCategory(category) { return CATEGORY_NAMES[category] ?? category; }

const sameEntry = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function createGuidePatch(rulebook, entries) {
  const existing = new Map((rulebook?.entries ?? []).map(entry => [entry.id, entry]));
  const incoming = new Set(entries.map(entry => entry.id));
  return { version: 1, mode: "patch", baseUpdatedAt: rulebook?.updatedAt ?? null,
    upserts: entries.filter(entry => !sameEntry(entry, existing.get(entry.id))),
    deleteIds: [...existing.keys()].filter(id => !incoming.has(id)) };
}

export function applyGuidePatch(current, patch) {
  if (patch?.version !== 1 || patch.mode !== "patch" || !Array.isArray(patch.upserts) || !Array.isArray(patch.deleteIds)) throw new Error("Invalid Studio Guidelines update.");
  if (patch.baseUpdatedAt !== (current?.updatedAt ?? null)) throw new Error("Studio Guidelines changed since this draft opened. Reload the dashboard and review your saved answers before publishing again.");
  const ids = patch.upserts.map(entry => entry?.id);
  const validId = id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
  if (ids.some(id => !validId(id)) || new Set(ids).size !== ids.length || patch.deleteIds.some(id => !validId(id) || ids.includes(id)) || new Set(patch.deleteIds).size !== patch.deleteIds.length) throw new Error("Invalid guideline IDs in this update.");
  const updates = new Map(patch.upserts.map(entry => [entry.id, entry]));
  const deleted = new Set(patch.deleteIds);
  const result = (current?.entries ?? []).filter(entry => !deleted.has(entry.id)).map(entry => {
    const updated = updates.get(entry.id) ?? entry; updates.delete(entry.id); return updated;
  });
  result.push(...updates.values());
  if (result.length > MAX_GUIDELINES) throw new Error(`Studio Guidelines supports up to ${MAX_GUIDELINES} entries.`);
  return { version: 1, entries: result };
}

// Restore private drafts without replacing a guideline changed on another device.
export function rebaseGuideDraft(base, draft, published) {
  const old = new Map(base.map(entry => [entry.id, entry]));
  const current = new Map(published.map(entry => [entry.id, entry]));
  const patch = createGuidePatch({ entries: base }, draft);
  const conflicts = [];
  for (const saved of patch.upserts) {
    const live = current.get(saved.id);
    if (!sameEntry(live, old.get(saved.id)) && !sameEntry(live, saved)) conflicts.push({ id: saved.id, title: saved.title, saved, published: live ?? null });
    else current.set(saved.id, saved);
  }
  for (const id of patch.deleteIds) {
    const live = current.get(id);
    if (live && !sameEntry(live, old.get(id))) conflicts.push({ id, title: live.title, saved: null, published: live });
    else current.delete(id);
  }
  return { entries: [...current.values()], conflicts };
}
