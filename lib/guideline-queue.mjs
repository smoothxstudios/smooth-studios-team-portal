import { GUIDELINE_QUESTIONS, guidelineQuestionEntryId } from "./studio-guideline-questions.mjs";
import { guidelineTopic, needsGuidelineAnswer } from "./guideline-content.mjs";
import { sameGuideline } from "./studio-guidelines.mjs";

export const questionEntryId = question => question.entryId ?? guidelineQuestionEntryId(question.id);
export const submittedEntryId = id => `question-submitted-${id}`;

export function guidelineQuestions(entries, submitted = []) {
  const items = GUIDELINE_QUESTIONS.map(question => ({ ...question, entryId: guidelineQuestionEntryId(question.id), source: "suggested", askedBy: null }));
  const known = new Set(items.map(questionEntryId));
  for (const row of submitted.filter(row => row.status !== "dismissed")) {
    const entryId = submittedEntryId(row.id);
    items.unshift({ id: `submitted-${row.id}`, entryId, title: row.question.slice(0, 120), prompt: row.question,
      category: entries.find(entry => entry.id === entryId)?.category ?? "General", choices: [], tags: ["team question"], source: "submitted", askedBy: row.askedBy });
    known.add(entryId);
  }
  for (const entry of entries.filter(entry => !known.has(entry.id) && needsGuidelineAnswer(entry.body))) {
    items.unshift({ id: `existing-${entry.id}`, entryId: entry.id, title: entry.title, prompt: entry.title,
      category: guidelineTopic(entry.category), choices: [], tags: entry.tags, source: "needs answer", askedBy: null });
  }
  return items;
}

export function questionState(question, entries, published) {
  const id = questionEntryId(question), saved = entries.find(entry => entry.id === id), live = published.find(entry => entry.id === id);
  if (!saved || needsGuidelineAnswer(saved.body)) return "unanswered";
  return live && !needsGuidelineAnswer(live.body) && sameGuideline(saved, live) ? "published" : "saved";
}
