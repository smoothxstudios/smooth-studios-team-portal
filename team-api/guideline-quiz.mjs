// Server-only: only published, team-visible guidelines enter the quiz bank.
import { GUIDELINE_SCENARIOS } from "./guideline-scenarios.mjs";
import { GUIDELINE_QUESTIONS } from "../lib/studio-guideline-questions.mjs";
const scenarios = new Map(GUIDELINE_SCENARIOS.map(item => [item.entryId, item]));
// A content-change check, not an authentication or secrecy mechanism.
export const guidelineFingerprint = value => [...value.replace(/\s+/g, " ").trim()].reduce((n, c) => Math.imul(n ^ c.codePointAt(0), 16777619) >>> 0, 2166136261).toString(16);
const unfinished = /^(answer later|tbd|todo|not provided|not answered|pending|skip)[.!]?$/i;
const templates = new Map(GUIDELINE_QUESTIONS.map(item => [`question-${item.id}`, item]));
const sensitive = /password|passcode|access code|door code|alarm code|wifi|wi-fi|api key|secret|credential|\bpin\b|https?:\/\/|\b\d{4,}\b|[\w.+-]+@[\w.-]+/i;
const clean = value => typeof value === "string" ? value.trim().replace(/\r\n/g, "\n") : "";
export function guidelineQuizBank(rulebook) {
  const entries = (rulebook?.entries ?? []).filter(entry => entry && typeof entry === "object");
  return entries.flatMap(entry => {
    const title = clean(entry.title), body = clean(entry.body);
    if (!title || !body || unfinished.test(body) || body.length > 900 || sensitive.test(`${title} ${body}`) || entry.visibility === "owner" || entry.private === true) return [];
    const scenario = scenarios.get(entry.id);
    const fingerprint = guidelineFingerprint(body);
    const matched = scenario?.fingerprint === fingerprint;
    const template = templates.get(entry.id);
    // A proposed policy is never an answer: require an exact published match.
    // Changed custom policies wait for review instead of grading an old scenario.
    const selected = template?.choices.find(choice => clean(choice.body) === body);
    if (!matched && !selected) return [];
    const correct = matched ? body.split(/\n\s*\n/)[0] : body;
    const alternatives = matched ? scenario.alternatives
      : template.choices.map(choice => clean(choice.body)).filter(choice => choice !== body);
    const choices = [correct, ...alternatives];
    if (choices.length < 3 || new Set(choices.map(choice => choice.toLowerCase())).size !== choices.length) return [];
    return [{ id: `guideline-v2-${entry.id}-${fingerprint}`, category: `Studio guidelines · ${entry.category || "Studio operations"}`,
      prompt: matched ? scenario.prompt : template.prompt, correct, choices, explanation: `${title}: ${body}`,
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
  return { questions: bank.length, scenarioQuestions: bank.filter(question => GUIDELINE_SCENARIOS.some(scenario => scenario.prompt === question.prompt)).length };
}
