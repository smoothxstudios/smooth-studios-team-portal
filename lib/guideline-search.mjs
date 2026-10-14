import { GUIDELINE_QUESTIONS, guidelineQuestionEntryId } from "./studio-guideline-questions.mjs";
import { needsGuidelineAnswer } from "./guideline-content.mjs";

const known = new Map(GUIDELINE_QUESTIONS.map(q => [guidelineQuestionEntryId(q.id), q]));
const stop = new Set("a an the i we you they them me my our your their it its is are be been was were do does did have has should would could can may must what when where who why how if for to of on at by with as or and about please need needs want wants get got am im not dont wont isnt doest someone client clients rental rentals studio studios team member members".split(" "));
const aliases = [
  ["late", "tardy", "delayed", "delay", "running behind"],
  ["extension", "extend", "overtime", "extra time", "more time", "add time", "longer", "overrun"],
  ["trigger", "flash", "strobe", "fire", "firing", "lighting", "lights", "snoot"],
  ["backdrop", "background", "paper", "seamless", "roll"],
  ["speaker", "bluetooth", "music", "audio"],
  ["polaroid", "instant photo", "instant picture", "photo book", "signature"],
  ["payment", "pay", "paid", "deposit", "balance", "invoice", "unpaid", "acuity", "stripe"],
  ["clean", "cleaning", "cleanup", "sweep", "broom", "dirty", "mess", "reset", "trash", "garbage"],
  ["lost", "missing", "forgot", "forgotten", "left behind", "found", "property"],
  ["access", "entry", "enter", "locked", "key", "keys", "lockout", "door"],
  ["close", "closing", "lock up", "last person", "end of day"],
  ["availability", "class", "classes", "schedule", "unavailable", "school"],
  ["swap", "replacement", "cover", "coverage", "cancel", "cannot make it", "cant make it"],
  ["battery", "batteries", "charge", "charging", "charger", "power bar"],
  ["damage", "damaged", "broken", "broke", "unsafe", "repair", "faulty", "rip", "ripped", "torn", "tear"],
  ["permission", "consent", "privacy", "private", "bts", "posting", "social media", "behind the scenes"],
  ["refund", "complaint", "unhappy", "dissatisfied", "money back"],
  ["attendees", "guest", "guests", "headcount", "capacity", "extra people"],
  ["parking", "park", "car", "vehicle", "loading", "unloading"],
  ["emergency", "injury", "injured", "hurt", "accident", "incident"],
];
const normalize = value => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const stem = word => word.length > 5 && word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
const tokens = value => [...new Set(normalize(value).split(" ").filter(word => word && !stop.has(word)).map(stem))];
const conceptTokens = aliases.map(group => new Set(group.flatMap(tokens)));
const concepts = value => {
  const normalized = ` ${normalize(value)} `, words = new Set(tokens(value));
  return aliases.map((group, index) => group.some(phrase => phrase.includes(" ") ? normalized.includes(` ${normalize(phrase)} `) : words.has(stem(phrase))) ? index : -1).filter(i => i >= 0);
};
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, prior[j] + 1, prior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prior = next;
  }
  return prior[b.length];
}
function wordMatch(word, candidate, fuzzy = true) {
  if (candidate === word) return 1;
  if (word.length >= 4 && candidate.startsWith(word)) return .85;
  if (fuzzy && word.length >= 5 && candidate.length >= 5 && distance(word, candidate) <= (word.length >= 7 ? 2 : 1)) return .65;
  return 0;
}
function excerpt(body, queryWords) {
  const pieces = body.split(/\n+|(?<=[.!?])\s+/).filter(Boolean);
  const best = pieces.sort((a, b) => queryWords.filter(w => tokens(b).some(t => wordMatch(w, t))).length - queryWords.filter(w => tokens(a).some(t => wordMatch(w, t))).length)[0] ?? body;
  return best.length > 190 ? `${best.slice(0, 187).trimEnd()}…` : best;
}

export function searchGuidelines(entries, query) {
  const usable = entries.filter(entry => !needsGuidelineAnswer(entry.body));
  if (!query.trim()) return usable.map(entry => ({ entry, score: 0, snippet: excerpt(entry.body, []) }));
  const words = tokens(query), queryConcepts = concepts(query);
  if (!words.length) return [];
  const vocabulary = [...new Set(usable.flatMap(entry => tokens(`${entry.title} ${known.get(entry.id)?.prompt ?? ""} ${entry.body} ${entry.tags.join(" ")}`)))];
  const fuzzyWords = new Set(words.filter(word => !vocabulary.some(candidate => wordMatch(word, candidate, false))));
  const natural = normalize(query);
  const intentIds = [];
  if (/(?:leaves?|left|forgot|lost|found).*\b(?:bag|phone|wallet|item|belonging|keys)|\blost property\b/.test(natural)) intentIds.push("lost-property");
  if (/\b(?:late|longer)\b/.test(natural) && /\b(?:stay|end|finish|leave)\b/.test(natural)) intentIds.push("overrun", "extension-approval");
  else if (/\blate\b/.test(natural) && /\b(?:client|renter|guest)\b/.test(natural)) intentIds.push("late-client");
  if (/\b(?:no show|doesnt show|not show)\b/.test(natural)) intentIds.push("no-show");
  const results = [];
  for (const entry of usable) {
    const prompt = known.get(entry.id)?.prompt ?? "";
    const fields = [[entry.title, 8], [prompt, 6], [entry.tags.join(" "), 4], [entry.body, 2], [entry.category, 1]];
    const indexed = fields.map(([value, weight]) => ({ words: tokens(value), weight }));
    const entryConcepts = new Set(concepts(`${entry.title} ${prompt} ${entry.body}`));
    let score = 0, covered = 0;
    for (const word of words) {
      const direct = Math.max(0, ...indexed.flatMap(field => field.words.map(candidate => wordMatch(word, candidate, fuzzyWords.has(word)) * field.weight)));
      const related = queryConcepts.some(i => conceptTokens[i].has(word) && entryConcepts.has(i));
      if (direct || related) covered++;
      score += direct || (related ? 1.2 : 0);
    }
    const ratio = covered / words.length;
    const intent = intentIds.some(id => entry.id === guidelineQuestionEntryId(id));
    if (!intent && (ratio < .5 || !score)) continue;
    if (normalize(entry.title).includes(normalize(query))) score += 10;
    score = score * ratio + queryConcepts.filter(i => entryConcepts.has(i)).length + (intent ? 18 : 0);
    results.push({ entry, score, snippet: excerpt(entry.body, words) });
  }
  return results.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
}
