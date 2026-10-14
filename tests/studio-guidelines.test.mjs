import test from "node:test";
import assert from "node:assert/strict";
import { applyGuidePatch, createGuidePatch, generalGuidelineCategory, MAX_GUIDELINES, MAX_GUIDELINE_UPDATE_BYTES, rebaseGuideDraft } from "../lib/studio-guidelines.mjs";
import { GUIDELINE_CATEGORIES, GUIDELINE_QUESTIONS, composeGuidelineAnswer, guidelineQuestionEntryId, tidyGuidelineAnswer } from "../lib/studio-guideline-questions.mjs";
import { decryptPayload, encryptPayload, normalizeRulebook } from "../scripts/lib/dashboard-data.mjs";
import { organizeGuideline, needsGuidelineAnswer, tidyGuidelineBody } from "../lib/guideline-content.mjs";
import { searchGuidelines } from "../lib/guideline-search.mjs";
import { guidelineQuestions, questionState, submittedEntryId } from "../lib/guideline-queue.mjs";

const entry = (id, body = `Instructions for ${id}.`) => ({ id, title: `Title ${id}`, category: "General", body, tags: [] });
const book = (entries, updatedAt = "2026-10-14T12:00:00.000Z") => ({ version: 1, updatedAt, entries });

test("publishing an answer preserves other guidelines and applies explicit edits and deletions", () => {
  const existing = book([entry("opening"), entry("rental"), entry("old")]);
  const desired = [entry("opening"), entry("rental", "Updated rental instructions."), entry("closing")];
  const patch = createGuidePatch(existing, desired);
  assert.deepEqual(patch.upserts.map(e => e.id), ["rental", "closing"]);
  assert.deepEqual(patch.deleteIds, ["old"]);
  assert.deepEqual(applyGuidePatch(existing, patch).entries, desired);
  assert.deepEqual(existing.entries.map(e => e.id), ["opening", "rental", "old"]);
  assert.equal(createGuidePatch(existing, existing.entries).upserts.length, 0);
});

test("a stale publication cannot overwrite newer published guidelines", () => {
  const old = book([entry("opening")]);
  const patch = createGuidePatch(old, [entry("opening", "Earlier draft")]);
  const live = book([entry("opening", "New approved policy")], "2026-10-14T13:00:00.000Z");
  assert.throws(() => applyGuidePatch(live, patch), /changed since this draft/);
  assert.equal(live.entries[0].body, "New approved policy");
});

test("patches reject duplicate, ambiguous and malformed guideline IDs", () => {
  const base = createGuidePatch(null, []);
  for (const invalid of [
    { upserts: [entry("x"), entry("x")] },
    { upserts: [entry("bad/id")] },
    { upserts: [null] },
    { upserts: [entry("x")], deleteIds: ["x"] },
    { deleteIds: ["x", "x"] },
    { deleteIds: [null] },
  ]) assert.throws(() => applyGuidePatch(null, { ...base, ...invalid }), /Invalid guideline IDs/);
});

test("the book supports 200 entries while only changed instructions use the update allowance", () => {
  const existing = book(Array.from({ length: MAX_GUIDELINES }, (_, i) => entry(`guide-${i}`, "Instructions. ".repeat(100))));
  assert.ok(Buffer.byteLength(JSON.stringify(existing)) > MAX_GUIDELINE_UPDATE_BYTES);
  const changed = existing.entries.map((e, i) => i === 0 ? { ...e, body: "New instructions." } : e);
  const patch = createGuidePatch(existing, changed);
  assert.ok(Buffer.byteLength(JSON.stringify(patch)) < MAX_GUIDELINE_UPDATE_BYTES);
  assert.equal(normalizeRulebook(applyGuidePatch(existing, patch)).entries.length, MAX_GUIDELINES);
  assert.throws(() => applyGuidePatch(existing, createGuidePatch(existing, [...existing.entries, entry("overflow")])), /200 entries/);
});

test("resuming drafts keeps independent published edits and local answers", () => {
  const base = [entry("opening"), entry("rental")];
  const local = [entry("opening"), entry("rental", "Local answer"), entry("closing")];
  const live = [entry("opening", "New opening policy"), entry("rental"), entry("equipment")];
  const restored = rebaseGuideDraft(base, local, live);
  assert.equal(restored.conflicts.length, 0);
  assert.deepEqual(restored.entries, [live[0], local[1], live[2], local[2]]);
});

test("resuming drafts flags changed or deleted guidelines for owner review", () => {
  const base = [entry("opening"), entry("rental"), entry("closing")];
  const local = [entry("opening", "Local opening"), entry("rental", "Local rental")];
  const live = [entry("opening", "Published opening"), entry("closing", "Published closing")];
  const restored = rebaseGuideDraft(base, local, live);
  assert.deepEqual(restored.entries, live);
  assert.equal(restored.conflicts.length, 3);
  assert.equal(restored.conflicts.find(c => c.id === "rental").published, null);
  assert.equal(restored.conflicts.find(c => c.id === "closing").saved, null);
});

test("reopening a successfully published draft does not create duplicate changes", () => {
  const base = [entry("opening")];
  const published = [entry("opening"), entry("question-arrival-time")];
  const restored = rebaseGuideDraft(base, published, published);
  assert.equal(restored.conflicts.length, 0);
  assert.equal(createGuidePatch(book(published), restored.entries).upserts.length, 0);
});

test("every suggested answer is publishable and the complete initial interview fits one update", () => {
  assert.equal(GUIDELINE_QUESTIONS.length, 115);
  assert.equal(GUIDELINE_CATEGORIES.length, 8);
  assert.equal(new Set(GUIDELINE_QUESTIONS.map(q => q.id)).size, GUIDELINE_QUESTIONS.length);
  const chosen = [];
  for (const question of GUIDELINE_QUESTIONS) {
    assert.equal(question.choices.length, 3);
    assert.equal(composeGuidelineAnswer(question, -1, ""), "");
    for (let i = 0; i < question.choices.length; i++) {
      const guideline = { id: guidelineQuestionEntryId(question.id), title: question.title, category: question.category, body: composeGuidelineAnswer(question, i, ""), tags: question.tags };
      assert.ok(guideline.body.length > 0);
      assert.deepEqual(normalizeRulebook({ entries: [guideline] }).entries[0], guideline);
      if (i === 0) chosen.push(guideline);
    }
  }
  assert.ok(Buffer.byteLength(JSON.stringify(createGuidePatch(null, chosen))) < MAX_GUIDELINE_UPDATE_BYTES);
});

test("custom answer cleanup preserves quantities, negation and exceptions", () => {
  assert.equal(tidyGuidelineAnswer("  arrive 15 mins early\n- do not leave for 1 hr unless I approve "), "Arrive 15 minutes early.\n- Do not leave for 1 hour unless I approve.");
  assert.equal(tidyGuidelineAnswer("wait 1 min then 2 hrs"), "Wait 1 minute then 2 hours.");
  const question = GUIDELINE_QUESTIONS[0];
  assert.equal(composeGuidelineAnswer(question, 0, "except when I specify otherwise"), `${question.choices[0].body}\n\nExcept when I specify otherwise.`);
  assert.equal(composeGuidelineAnswer(question, -1, "ask me first"), "Ask me first.");
});

test("drafts and publication patches remain unreadable with another profile password", () => {
  const patch = createGuidePatch(null, [entry("private", "Private studio policy.")]);
  const envelope = encryptPayload(patch, "owner-test-password");
  assert.equal(JSON.stringify(envelope).includes("Private studio policy"), false);
  assert.deepEqual(decryptPayload(envelope, "owner-test-password"), patch);
  assert.throws(() => decryptPayload(envelope, "employee-test-password"));
});

test("legacy categories broaden without changing custom categories or instructions", () => {
  assert.equal(generalGuidelineCategory("Before the rental"), "Rentals & clients");
  assert.equal(generalGuidelineCategory("After the rental"), "Cleaning & reset");
  assert.equal(generalGuidelineCategory("My custom topic"), "My custom topic");
});

test("formatting is idempotent and preserves timing, amounts, negation, lists and URLs", () => {
  const raw = "  dont collect $50 unless I approve\n* wait 15 mins, not 30 mins\n* email me at studio@example.invalid\n\nhttps://example.invalid/Booking";
  const formatted = tidyGuidelineBody(raw);
  assert.equal(formatted, "Don't collect $50 unless I approve.\n- Wait 15 minutes, not 30 minutes.\n- Email me at studio@example.invalid\n\nhttps://example.invalid/Booking");
  assert.equal(tidyGuidelineBody("https://example.invalid/im/dont\nstudio.im@example.invalid"), "https://example.invalid/im/dont\nstudio.im@example.invalid");
  assert.equal(tidyGuidelineBody(formatted), formatted);
});

test("organization updates do not create conflicts or turn published answers back into drafts", () => {
  const original = { ...entry("question-arrival-time", "arrive 15 mins early"), category: "Team & scheduling" };
  const organized = organizeGuideline(original);
  const restored = rebaseGuideDraft([], [original], [organized]);
  assert.equal(restored.conflicts.length, 0);
  assert.deepEqual(restored.entries, [organized]);
  assert.equal(createGuidePatch(book([organized]), [original]).upserts.length, 0);
  assert.equal(questionState(guidelineQuestions([original])[0], [original], [organized]), "published");
});

test("uncertain answers stay in the queue and do not appear as completed policies", () => {
  for (const value of ["", "IDK.", "I'm not sure", "Not sure yet.", "TBD", "Ask me later."]) {
    assert.equal(needsGuidelineAnswer(value), true, value);
  }
  for (const value of ["No.", "No extra people.", "Ask me before moving equipment.", "Not applicable."]) assert.equal(needsGuidelineAnswer(value), false, value);
  const entries = [{ ...entry("question-arrival-time", "Not sure."), title: "Arrival time" }];
  assert.equal(questionState(guidelineQuestions(entries)[0], entries, entries), "unanswered");
  assert.equal(searchGuidelines(entries, "arrival").length, 0);
});

test("new, submitted, and incomplete custom questions join the queue without duplicating answered topics", () => {
  const originalAnswers = GUIDELINE_QUESTIONS.slice(0, 91).map(q => ({ id: guidelineQuestionEntryId(q.id), title: q.title, category: q.category, body: q.choices[0].body, tags: q.tags }));
  const rows = [{ id: "one", question: "Where are the spare AA batteries?", status: "open", askedBy: "jordyn" }];
  const questions = guidelineQuestions([...originalAnswers, entry("custom", "TBD")], rows);
  assert.equal(questions.filter(q => questionState(q, originalAnswers, originalAnswers) === "unanswered").length, 26);
  const submitted = questions.find(q => q.entryId === submittedEntryId("one"));
  const answer = entry(submitted.entryId, "Check the designated supply shelf.");
  assert.equal(questionState(submitted, [answer], []), "saved");
  assert.equal(questionState(submitted, [answer], [answer]), "published");
});

test("natural queries, synonyms and typos rank relevant published answers without inventing a result", () => {
  const entries = GUIDELINE_QUESTIONS.map(q => ({ id: guidelineQuestionEntryId(q.id), title: q.title, category: q.category, body: q.choices[0].body, tags: q.tags }));
  for (const [query, expected] of [
    ["What if a client wants more time?", "extension-approval"],
    ["the light wont fire", "trigger-troubleshooting"],
    ["running behind", "running-late"],
    ["backdorp ripped", "damaged-paper"],
    ["what if someone leaves a bag", "lost-property"],
    ["Can I give someone their money back?", "refund-requests"],
    ["how late can clients stay", "overrun"],
  ]) assert.ok(searchGuidelines(entries, query).slice(0, 2).some(result => result.entry.id === guidelineQuestionEntryId(expected)), query);
  assert.equal(searchGuidelines(entries, "zebra astronaut").length, 0);
  assert.equal(searchGuidelines([], "refund").length, 0);
});
