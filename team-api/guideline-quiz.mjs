// Server-only: only published, team-visible guidelines enter the quiz bank.
import { GUIDELINE_QUESTIONS } from "../lib/studio-guideline-questions.mjs";
const templates = new Map(GUIDELINE_QUESTIONS.map(item => [`question-${item.id}`, item]));
const sensitive = /password|passcode|access code|door code|alarm code|wifi|wi-fi|api key|secret|credential|\bpin\b|https?:\/\/|\b\d{4,}\b|[\w.+-]+@[\w.-]+/i;
const clean = value => typeof value === "string" ? value.trim().replace(/\r\n/g, "\n") : "";
export function guidelineQuizBank(rulebook) {
  const entries = (rulebook?.entries ?? []).filter(entry => entry && typeof entry === "object");
  return entries.flatMap(entry => {
    const title = clean(entry.title), body = clean(entry.body);
    if (!title || !body || body.length > 900 || sensitive.test(`${title} ${body}`) || entry.visibility === "owner" || entry.private === true) return [];
    const template = templates.get(entry.id);
    // Suggested policies are never treated as answers. Require an exact saved match.
    const selected = template?.choices.find(choice => clean(choice.body) === body);
    const alternatives = selected ? template.choices.map(choice => clean(choice.body)).filter(choice => choice !== body)
      : [...new Set(entries.filter(other => other.id !== entry.id && other.visibility !== "owner" && other.private !== true && !sensitive.test(`${clean(other.title)} ${clean(other.body)}`))
        .map(other => clean(other.body)).filter(text => text && text !== body && text.length <= 900 && !sensitive.test(text)))].slice(0, 3);
    const choices = [body, ...alternatives];
    if (choices.length < 3 || new Set(choices).size !== choices.length) return [];
    return [{ id: `guideline-${entry.id}`, category: `Studio guidelines · ${entry.category || "Studio operations"}`,
      prompt: selected ? template.prompt : `Which instruction is saved under “${title}” in the studio guidelines?`, correct: body, choices, explanation: `Saved studio guideline — ${title}: ${body}`,
      source: { label: `Studio guidelines · ${title}`, url: "https://dashboard.smoothstudios.co/#guidelines", kind: "studio-guideline" } }];
  });
}
export async function syncGuidelineQuiz({ request, db, user, body, fail }) {
  if (user !== "sync") fail(403, "Only the studio sync can publish guideline questions.");
  if (request.method !== "POST") fail(405, "Use POST to sync studio guidelines.");
  const input = await body(request);
  if (!input || typeof input.updatedAt !== "string" || !Number.isFinite(Date.parse(input.updatedAt)) || !Array.isArray(input.entries) || input.entries.length > 200 || JSON.stringify(input).length > 60000) fail(400, "Invalid published guidelines.");
  const bank = guidelineQuizBank(input);
  await db.prepare(`INSERT INTO team_quiz_guidelines (id, updated_at, data) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data
    WHERE excluded.updated_at >= team_quiz_guidelines.updated_at`).bind(new Date(input.updatedAt).toISOString(), JSON.stringify(bank)).run();
  return { questions: bank.length };
}
