"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { decryptPrivatePayload, encryptWorkflowPayload } from "@/lib/dashboard-crypto";
import { GUIDELINE_CATEGORIES, GUIDELINE_QUESTIONS, composeGuidelineAnswer, guidelineQuestionEntryId } from "@/lib/studio-guideline-questions.mjs";
import { createGuidePatch, MAX_GUIDELINES, rebaseGuideDraft } from "@/lib/studio-guidelines.mjs";
import type { StudioGuideline, StudioRulebook } from "@/lib/dashboard-types";

const STORAGE_KEY = "smooth-studios-team-portal:guidelines-interview:v1";
type Conflict = { id: string; title: string; saved: StudioGuideline | null; published: StudioGuideline | null };
type Draft = { version: 1; baseEntries: StudioGuideline[]; entries: StudioGuideline[]; cursor: string; skipped: string[]; conflicts: Conflict[] };
const validEntries = (value: unknown): value is StudioGuideline[] => Array.isArray(value) && value.length <= MAX_GUIDELINES && value.every(entry => entry &&
  typeof entry.id === "string" && typeof entry.title === "string" && typeof entry.category === "string" && typeof entry.body === "string" && Array.isArray(entry.tags));

export function GuidelineInterview({ open, onOpenChange, rulebook, password, onPublish }: {
  open: boolean; onOpenChange: (open: boolean) => void; rulebook?: StudioRulebook;
  password: string; onPublish: (entries: StudioGuideline[]) => Promise<void>;
}) {
  const published = useMemo(() => rulebook?.entries ?? [], [rulebook]);
  const initial = (): Draft => ({ version: 1, baseEntries: published, entries: published, cursor: GUIDELINE_QUESTIONS[0].id, skipped: [], conflicts: [] });
  const [draft, setDraft] = useState<Draft>(initial);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [category, setCategory] = useState("All topics");
  const [choice, setChoice] = useState(-2);
  const [custom, setCustom] = useState("");
  const [preview, setPreview] = useState("");
  const [publishing, setPublishing] = useState(false);
  const saveGeneration = useRef(0);
  const questionHeading = useRef<HTMLDivElement>(null);
  const previousQuestion = useRef(draft.cursor);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setLoadError("");
    ++saveGeneration.current;
    const restore = async () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const saved = await decryptPrivatePayload<Draft>(JSON.parse(stored), password);
          if (saved.version !== 1 || !validEntries(saved.baseEntries) || !validEntries(saved.entries) || !Array.isArray(saved.skipped)) throw new Error("Invalid saved draft");
          const restored = rebaseGuideDraft(saved.baseEntries, saved.entries, published) as { entries: StudioGuideline[]; conflicts: Conflict[] };
          const conflicts = new Map(restored.conflicts.map(item => [item.id, item]));
          for (const item of saved.conflicts ?? []) {
            const current = published.find(entry => entry.id === item.id) ?? null;
            if (JSON.stringify(current) !== JSON.stringify(item.saved)) conflicts.set(item.id, { ...item, published: current });
          }
          if (!cancelled) setDraft({ version: 1, baseEntries: published, entries: restored.entries,
            cursor: GUIDELINE_QUESTIONS.some(question => question.id === saved.cursor) ? saved.cursor : GUIDELINE_QUESTIONS[0].id,
            skipped: saved.skipped.filter(id => GUIDELINE_QUESTIONS.some(question => question.id === id)), conflicts: [...conflicts.values()] });
        } else if (!cancelled) setDraft(initial());
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setLoadError("This browser's saved question draft could not be opened. Published guidelines are still available and unchanged.");
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [published, password]);

  useEffect(() => {
    if (!ready || draft.baseEntries !== published) return;
    const generation = ++saveGeneration.current;
    setSaveStatus("Saving draft…");
    void encryptWorkflowPayload(draft, password).then(envelope => {
      if (generation !== saveGeneration.current) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
      setSaveStatus("Draft saved on this device");
    }).catch(() => { if (generation === saveGeneration.current) setSaveStatus("This browser could not save the draft. Publish your saved answers before leaving."); });
  }, [draft, password, ready, published]);

  const question = GUIDELINE_QUESTIONS.find(item => item.id === draft.cursor) ?? GUIDELINE_QUESTIONS[0];
  const answer = draft.entries.find(entry => entry.id === guidelineQuestionEntryId(question.id));
  useEffect(() => {
    setChoice(answer ? -1 : -2); setCustom(answer?.body ?? ""); setPreview(answer?.body ?? ""); setError("");
  }, [question.id, answer?.body]);
  useEffect(() => {
    if (previousQuestion.current !== question.id && open) {
      questionHeading.current?.focus({ preventScroll: true });
      questionHeading.current?.scrollIntoView({ block: "start" });
    }
    previousQuestion.current = question.id;
  }, [question.id, open]);

  const answeredIds = useMemo(() => new Set(draft.entries.map(entry => entry.id)), [draft.entries]);
  const answeredCount = GUIDELINE_QUESTIONS.filter(item => answeredIds.has(guidelineQuestionEntryId(item.id))).length;
  const questions = GUIDELINE_QUESTIONS.filter(item => category === "All topics" || item.category === category);
  const position = questions.findIndex(item => item.id === question.id);
  const changes = createGuidePatch(rulebook, draft.entries);
  const changeCount = changes.upserts.length + changes.deleteIds.length;
  const isPublished = published.some(entry => entry.id === guidelineQuestionEntryId(question.id) && entry.body === answer?.body);
  const unsavedAnswer = Boolean(preview.trim() && preview.trim() !== (answer?.body ?? ""));

  const navigate = (id: string) => setDraft(current => ({ ...current, cursor: id }));
  const nextQuestion = (entries: StudioGuideline[], skipped: string[]) => {
    const savedIds = new Set(entries.map(entry => entry.id));
    const ordered = [...questions.slice(position + 1), ...questions.slice(0, position)];
    return ordered.find(item => !savedIds.has(guidelineQuestionEntryId(item.id)) && !skipped.includes(item.id))?.id
      ?? ordered.find(item => !savedIds.has(guidelineQuestionEntryId(item.id)))?.id ?? question.id;
  };
  const saveAnswer = () => {
    const body = preview.trim();
    if (!body || body.length > 5000) { setError("Add a guideline of up to 5,000 characters before saving."); return; }
    const id = guidelineQuestionEntryId(question.id);
    if (!answer && draft.entries.length >= MAX_GUIDELINES) { setError(`The guidelines can contain up to ${MAX_GUIDELINES} entries.`); return; }
    const entry: StudioGuideline = { id, title: question.title, category: question.category, body, tags: question.tags };
    const entries = answer ? draft.entries.map(item => item.id === id ? entry : item) : [...draft.entries, entry];
    const skipped = draft.skipped.filter(item => item !== question.id);
    const cursor = nextQuestion(entries, skipped);
    setDraft(current => ({ ...current, entries, skipped, cursor }));
    setNotice(`Saved “${question.title}” under ${question.category}.`);
    setError("");
  };
  const skipQuestion = () => {
    const skipped = [...new Set([...draft.skipped, question.id])];
    setDraft(current => ({ ...current, skipped, cursor: nextQuestion(current.entries, skipped) }));
    setNotice("Skipped for now. You can return to this question from the question list.");
  };
  const resolveConflict = (item: Conflict, useSaved: boolean) => {
    setDraft(current => {
      let entries = current.entries;
      if (useSaved) entries = item.saved
        ? entries.some(entry => entry.id === item.id) ? entries.map(entry => entry.id === item.id ? item.saved! : entry) : [...entries, item.saved]
        : entries.filter(entry => entry.id !== item.id);
      return { ...current, entries, conflicts: current.conflicts.filter(conflict => conflict.id !== item.id) };
    });
  };
  const publish = async () => {
    setPublishing(true); setError("");
    try { await onPublish(draft.entries); onOpenChange(false); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not prepare these guidelines."); }
    finally { setPublishing(false); }
  };

  return <Dialog open={open} onOpenChange={value => { if (!publishing) onOpenChange(value); }}>
    <DialogContent className="guide-interview-dialog">
      <DialogHeader><p className="eyebrow">Build your guidelines</p><DialogTitle>How should the studio run?</DialogTitle>
        <DialogDescription>{GUIDELINE_QUESTIONS.length} questions across {GUIDELINE_CATEGORIES.length} topics. Choose an answer or write your own, review the wording, then save. Only published answers become team guidelines.</DialogDescription></DialogHeader>
      {loadError ? <div className="guide-interview-alert" role="alert"><p>{loadError}</p><Button variant="outline" onClick={() => { try { localStorage.removeItem(STORAGE_KEY); } catch {} setDraft(initial()); setLoadError(""); setReady(true); }}>Start a new question draft</Button></div> : <>
        <div className="guide-interview-progress"><div><strong>{answeredCount} of {GUIDELINE_QUESTIONS.length} answered</strong><span>{changeCount} unpublished change{changeCount === 1 ? "" : "s"}</span></div><progress aria-label="Questions answered" max={GUIDELINE_QUESTIONS.length} value={answeredCount} /></div>
        {draft.conflicts.length > 0 && <div className="guide-interview-alert" role="alert"><strong>Review changes made since your draft was saved</strong><p>A newer version of these guidelines is published. Choose which version to keep before publishing your draft.</p>{draft.conflicts.map(item => <div className="guide-conflict" key={item.id}><strong>{item.title}</strong><p>Published: {item.published?.body ?? "Removed"}</p><p>Saved draft: {item.saved?.body ?? "Remove this guideline"}</p><Button variant="outline" onClick={() => resolveConflict(item, false)}>Keep published version</Button><Button variant="outline" onClick={() => resolveConflict(item, true)}>Use saved draft</Button></div>)}</div>}
        <div className="guide-interview-navigation">
          <label>Topic<select disabled={!ready || publishing} value={category} onChange={event => { const next = event.target.value; setCategory(next); const first = GUIDELINE_QUESTIONS.find(item => next === "All topics" || item.category === next); if (first) navigate(first.id); }}><option>All topics</option>{GUIDELINE_CATEGORIES.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>Jump to a question<select disabled={!ready || publishing} value={question.id} onChange={event => navigate(event.target.value)}>{questions.map((item, index) => <option value={item.id} key={item.id}>{answeredIds.has(guidelineQuestionEntryId(item.id)) ? "✓ " : draft.skipped.includes(item.id) ? "↷ " : ""}{index + 1}. {item.title}</option>)}</select></label>
        </div>
        <div className="guide-question-heading" tabIndex={-1} ref={questionHeading}><Badge variant="secondary">{question.category}</Badge>{answer && <span><CheckCircle2 size={15} />{isPublished ? "Published" : "Saved in draft"}</span>}<h3>{question.prompt}</h3><p>These are suggestions. Choose what fits Smooth Studios or describe a different rule.</p></div>
        <fieldset className="guide-answer-options" disabled={!ready || publishing}><legend className="sr-only">Suggested answers</legend>
          {question.choices.map((item, index) => <label className={choice === index ? "selected" : ""} key={item.label}><input type="radio" name="guideline-answer" checked={choice === index} onChange={() => { setChoice(index); setCustom(""); setPreview(item.body); }} /><span><strong>{item.label}</strong><small>{item.body}</small></span>{choice === index && <Check size={18} />}</label>)}
          <label className={choice === -1 ? "selected" : ""}><input type="radio" name="guideline-answer" checked={choice === -1} onChange={() => { setChoice(-1); setPreview(composeGuidelineAnswer(question, -1, custom)); }} /><span><strong>Write my own answer</strong><small>Use your own policy, timing, or instructions.</small></span>{choice === -1 && <Check size={18} />}</label>
        </fieldset>
        <label className="guide-answer-label">{choice >= 0 ? "Add details or exceptions (optional)" : "Your answer"}<Textarea disabled={!ready || publishing} maxLength={4000} rows={3} value={custom} onChange={event => { setCustom(event.target.value); if (choice === -2) setChoice(-1); setPreview(composeGuidelineAnswer(question, choice, event.target.value)); }} placeholder="Tell the team exactly what to do. Specific times, locations, and exceptions help." /></label>
        {preview.trim() && <section className="guide-answer-preview"><div><span>Guideline preview · editable</span><Badge variant="secondary">{question.category}</Badge></div><h4>{question.title}</h4><Textarea aria-label="Guideline preview" disabled={publishing} maxLength={5000} rows={4} value={preview} onChange={event => setPreview(event.target.value)} /><p>Suggested answers are written as instructions. Custom text is tidied without adding new rules. Adjust the final wording here.</p></section>}
        {(error || notice) && <p className={`guide-manager-message ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{error || notice}</p>}
        {answeredCount === GUIDELINE_QUESTIONS.length && <p className="guide-manager-message">You have answered every question. Review any topic or publish your remaining changes.</p>}
        <div className="guide-question-actions"><Button variant="ghost" disabled={!ready || publishing || position <= 0} onClick={() => navigate(questions[position - 1].id)}><ArrowLeft size={16} /> Back</Button><Button variant="outline" disabled={!ready || publishing} onClick={skipQuestion}><SkipForward size={16} /> Skip for now</Button><Button disabled={!ready || publishing || !preview.trim()} onClick={saveAnswer}>Save answer & next <ArrowRight size={16} /></Button></div>
        <div className="guide-interview-footer"><div><strong>{ready ? saveStatus : "Opening your private draft…"}</strong><span>{unsavedAnswer ? "This answer has unsaved changes. Use Save answer & next before publishing." : "Save each answer to keep your progress. Publish to share it with the team."}</span></div><Button variant="outline" disabled={publishing} onClick={() => onOpenChange(false)}>Pause</Button><Button disabled={!ready || publishing || !changeCount || draft.conflicts.length > 0 || unsavedAnswer} onClick={publish}>{publishing ? "Preparing…" : `Publish saved answers (${changeCount})`}</Button></div>
      </>}
    </DialogContent>
  </Dialog>;
}
