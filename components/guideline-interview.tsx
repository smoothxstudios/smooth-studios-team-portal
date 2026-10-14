"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Search, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { decryptPrivatePayload, encryptWorkflowPayload } from "@/lib/dashboard-crypto";
import { composeGuidelineAnswer } from "@/lib/studio-guideline-questions.mjs";
import { GUIDELINE_TOPICS, guidelineTopic, needsGuidelineAnswer, tidyGuidelineBody } from "@/lib/guideline-content.mjs";
import { guidelineQuestions, questionEntryId, questionState } from "@/lib/guideline-queue.mjs";
import { createGuidePatch, MAX_GUIDELINES, rebaseGuideDraft, sameGuideline } from "@/lib/studio-guidelines.mjs";
import type { GuidelineQuestionRequest } from "@/lib/team-api";
import type { StudioGuideline, StudioRulebook } from "@/lib/dashboard-types";

const STORAGE_KEY = "smooth-studios-team-portal:guidelines-interview:v1";
type Conflict = { id: string; title: string; saved: StudioGuideline | null; published: StudioGuideline | null };
type Draft = { version: 1; baseEntries: StudioGuideline[]; entries: StudioGuideline[]; cursor: string; skipped: string[]; conflicts: Conflict[] };
type Question = { id: string; entryId: string; title: string; prompt: string; category: string; choices: { label: string; body: string }[]; tags: string[]; source: string; askedBy: string | null };
const validEntries = (value: unknown): value is StudioGuideline[] => Array.isArray(value) && value.length <= MAX_GUIDELINES && value.every(entry => entry && typeof entry.id === "string" && typeof entry.title === "string" && typeof entry.category === "string" && typeof entry.body === "string" && Array.isArray(entry.tags));

export function GuidelineInterview({ open, onOpenChange, rulebook, password, onPublish, requests = [], onAddQuestion }: {
  open: boolean; onOpenChange: (open: boolean) => void; rulebook?: StudioRulebook; password: string;
  onPublish: (entries: StudioGuideline[]) => Promise<void>; requests?: GuidelineQuestionRequest[];
  onAddQuestion: (question: string) => Promise<void>;
}) {
  const published = useMemo(() => rulebook?.entries ?? [], [rulebook]);
  const initial = (): Draft => ({ version: 1, baseEntries: published, entries: published, cursor: "", skipped: [], conflicts: [] });
  const [draft, setDraft] = useState<Draft>(initial);
  const allQuestions = useMemo<Question[]>(() => guidelineQuestions(draft.entries, requests) as Question[], [draft.entries, requests]);
  const [ready, setReady] = useState(false), [loadError, setLoadError] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [saveStatus, setSaveStatus] = useState("");
  const [category, setCategory] = useState("All topics"), [queueFilter, setQueueFilter] = useState("unanswered"), [query, setQuery] = useState("");
  const [answering, setAnswering] = useState(false), [answerCategory, setAnswerCategory] = useState("General");
  const [choice, setChoice] = useState(-2), [custom, setCustom] = useState(""), [preview, setPreview] = useState("");
  const [publishing, setPublishing] = useState(false), [adding, setAdding] = useState(false), [newQuestion, setNewQuestion] = useState("");
  const saveGeneration = useRef(0), questionHeading = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setAnswering(false); setError(""); } }, [open]);

  useEffect(() => {
    let cancelled = false;
    setReady(false); setLoadError(""); ++saveGeneration.current;
    void (async () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const saved = await decryptPrivatePayload<Draft>(JSON.parse(stored), password);
          if (saved.version !== 1 || !validEntries(saved.baseEntries) || !validEntries(saved.entries) || !Array.isArray(saved.skipped)) throw new Error("Invalid saved draft");
          const restored = rebaseGuideDraft(saved.baseEntries, saved.entries, published) as { entries: StudioGuideline[]; conflicts: Conflict[] };
          const conflicts = new Map(restored.conflicts.map(item => [item.id, item]));
          for (const item of saved.conflicts ?? []) {
            const current = published.find(entry => entry.id === item.id) ?? null;
            if (!sameGuideline(current, item.saved)) conflicts.set(item.id, { ...item, published: current });
          }
          if (!cancelled) setDraft({ version: 1, baseEntries: published, entries: restored.entries,
            cursor: typeof saved.cursor === "string" ? saved.cursor : "", skipped: saved.skipped.filter(id => typeof id === "string"), conflicts: [...conflicts.values()] });
        } else if (!cancelled) setDraft(initial());
        if (!cancelled) setReady(true);
      } catch { if (!cancelled) setLoadError("This browser's saved draft could not be opened. Your published guidelines are still available."); }
    })();
    return () => { cancelled = true; ++saveGeneration.current; };
  }, [published, password]);

  useEffect(() => {
    if (!ready || draft.baseEntries !== published) return;
    const generation = ++saveGeneration.current;
    setSaveStatus("Saving draft…");
    void encryptWorkflowPayload(draft, password).then(envelope => {
      if (generation !== saveGeneration.current) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope)); setSaveStatus("Draft saved on this device");
    }).catch(() => { if (generation === saveGeneration.current) setSaveStatus("Draft could not be saved on this device. Publish before leaving."); });
  }, [draft, password, ready, published]);

  const stateOf = (question: Question) => questionState(question, draft.entries, published);
  const unanswered = allQuestions.filter(question => stateOf(question) === "unanswered");
  const savedCount = allQuestions.filter(question => stateOf(question) === "saved").length;
  const filtered = allQuestions.filter(question => (category === "All topics" || question.category === category) &&
    (queueFilter === "all" || stateOf(question) === queueFilter) && `${question.title} ${question.prompt} ${question.category}`.toLowerCase().includes(query.toLowerCase().trim()))
    .sort((a, b) => Number(draft.skipped.includes(a.id)) - Number(draft.skipped.includes(b.id)));
  const question = allQuestions.find(item => item.id === draft.cursor) ?? unanswered[0] ?? allQuestions[0];
  const answer = question && draft.entries.find(entry => entry.id === questionEntryId(question));
  useEffect(() => {
    const body = needsGuidelineAnswer(answer?.body) ? "" : tidyGuidelineBody(answer?.body);
    setChoice(body ? -1 : -2); setCustom(body); setPreview(body); setAnswerCategory(guidelineTopic(answer?.category ?? question?.category)); setError("");
  }, [question?.id, answer?.body, answer?.category]);
  useEffect(() => { if (open && answering) questionHeading.current?.scrollIntoView({ block: "start" }); }, [question?.id, answering, open]);
  const changes = createGuidePatch(rulebook, draft.entries), changeCount = changes.upserts.length + changes.deleteIds.length;
  const unsavedAnswer = answering && Boolean(preview.trim() && (tidyGuidelineBody(preview) !== tidyGuidelineBody(answer?.body) || answerCategory !== guidelineTopic(answer?.category)));
  const navigate = (item: Question) => { setDraft(current => ({ ...current, cursor: item.id })); setAnswering(true); setNotice(""); };

  const saveAnswer = () => {
    if (!question) return;
    const body = tidyGuidelineBody(preview);
    if (needsGuidelineAnswer(body)) { setError("This still needs a decision. Use Save for later to keep it in your queue."); return; }
    if (body.length > 5000) { setError("Keep this answer within 5,000 characters."); return; }
    if (!answer && draft.entries.length >= MAX_GUIDELINES) { setError(`The guide supports ${MAX_GUIDELINES} entries.`); return; }
    const id = questionEntryId(question);
    const entry: StudioGuideline = { id, title: question.title, category: answerCategory, body, tags: question.tags };
    const entries = answer ? draft.entries.map(item => item.id === id ? entry : item) : [...draft.entries, entry];
    const skipped = draft.skipped.filter(id => id !== question.id);
    const next = filtered.find(item => item.id !== question.id && questionState(item, entries, published) === "unanswered" && !skipped.includes(item.id));
    setDraft(current => ({ ...current, entries, skipped, cursor: next?.id ?? question.id }));
    setAnswering(Boolean(next)); setNotice(`Saved “${question.title}” in ${answerCategory}. Publish to share it with the team.`); setError("");
  };
  const defer = () => {
    if (!question) return;
    setDraft(current => ({ ...current, skipped: [...new Set([...current.skipped, question.id])] }));
    setAnswering(false); setNotice("Saved for later. This question will remain in your unanswered queue.");
  };
  const resolveConflict = (item: Conflict, useSaved: boolean) => setDraft(current => {
    let entries = current.entries;
    if (useSaved) entries = item.saved ? entries.some(entry => entry.id === item.id) ? entries.map(entry => entry.id === item.id ? item.saved! : entry) : [...entries, item.saved] : entries.filter(entry => entry.id !== item.id);
    return { ...current, entries, conflicts: current.conflicts.filter(conflict => conflict.id !== item.id) };
  });
  const publish = async () => {
    setPublishing(true); setError("");
    try { await onPublish(draft.entries); onOpenChange(false); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not prepare these guidelines."); }
    finally { setPublishing(false); }
  };
  const addQuestion = async () => {
    setAdding(true); setError("");
    try { await onAddQuestion(newQuestion); setNewQuestion(""); setQueueFilter("unanswered"); setCategory("All topics"); setQuery(""); setNotice("Question added to your queue."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Question could not be added."); }
    finally { setAdding(false); }
  };

  return <Dialog open={open} onOpenChange={value => { if (!publishing) onOpenChange(value); }}><DialogContent className="guide-interview-dialog">
    <DialogHeader><p className="eyebrow">Studio Guidelines</p><DialogTitle>{answering ? "Answer a question" : "Questions to answer"}</DialogTitle><DialogDescription>{answering ? "Choose or write the answer, review the wording, then save it for publication." : "Unfinished decisions, team questions, and new topics stay here until you answer them. Work through a few whenever you have time."}</DialogDescription></DialogHeader>
    {loadError ? <div className="guide-interview-alert" role="alert"><p>{loadError}</p><Button variant="outline" onClick={() => { try { localStorage.removeItem(STORAGE_KEY); } catch {} setDraft(initial()); setLoadError(""); setReady(true); }}>Start a new draft</Button></div> : <>
      {draft.conflicts.length > 0 && <div className="guide-interview-alert" role="alert"><strong>Review changes made since your draft was saved</strong>{draft.conflicts.map(item => <div className="guide-conflict" key={item.id}><strong>{item.title}</strong><p>Published: {item.published?.body ?? "Removed"}</p><p>Saved draft: {item.saved?.body ?? "Remove this guideline"}</p><Button variant="outline" onClick={() => resolveConflict(item, false)}>Keep published</Button><Button variant="outline" onClick={() => resolveConflict(item, true)}>Use my draft</Button></div>)}</div>}
      {!answering ? <>
        <div className="guide-queue-stats"><strong>{unanswered.length} to answer</strong><span>{savedCount} saved drafts</span><span>{changeCount} unpublished changes</span></div>
        <div className="guide-interview-navigation"><label>Show<select value={queueFilter} onChange={e => setQueueFilter(e.target.value)}><option value="unanswered">Unanswered questions</option><option value="saved">Saved answers to publish</option><option value="published">Published answers</option><option value="all">All questions</option></select></label><label>Topic<select value={category} onChange={e => setCategory(e.target.value)}><option>All topics</option>{[...GUIDELINE_TOPICS, "General"].map(item => <option key={item}>{item}</option>)}</select></label></div>
        <div className="guide-search"><Search size={18} /><Input aria-label="Search the question queue" placeholder="Find a question in your queue" value={query} onChange={e => setQuery(e.target.value)} /></div>
        <div className="guide-question-queue">{filtered.length ? filtered.map(item => <button disabled={!ready} type="button" key={item.id} onClick={() => navigate(item)}><span><small>{item.category} · {item.source === "submitted" ? "Team question" : stateOf(item) === "published" ? "Published" : stateOf(item) === "saved" ? "Draft saved" : draft.skipped.includes(item.id) ? "Saved for later" : "Needs an answer"}</small><strong>{item.prompt}</strong></span><ArrowRight size={17} /></button>) : <div className="guide-queue-empty"><CheckCircle2 /><strong>{unanswered.length ? "No questions in this view" : "You're caught up"}</strong><p>{unanswered.length ? "Choose another topic or clear your search." : "New and submitted questions will appear here. You can add one below."}</p></div>}</div>
        <div className="guide-add-question"><label htmlFor="guide-new-question">Add a question for later</label><Textarea id="guide-new-question" rows={2} maxLength={300} placeholder="What else should the team know?" value={newQuestion} onChange={e => setNewQuestion(e.target.value)} /><Button disabled={adding || newQuestion.trim().length < 8} variant="outline" onClick={addQuestion}>{adding ? "Adding…" : "Add to queue"}</Button></div>
      </> : question && <>
        <Button className="guide-back-to-queue" variant="ghost" onClick={() => setAnswering(false)}><ArrowLeft size={16} /> Back to queue</Button>
        <div className="guide-question-heading" ref={questionHeading}><Badge variant="secondary">{question.category}</Badge><h3>{question.prompt}</h3>{question.choices.length > 0 && <p>Choose a suggested answer or describe your policy.</p>}</div>
        {question.choices.length > 0 && <fieldset className="guide-answer-options" disabled={!ready || publishing}><legend className="sr-only">Suggested answers</legend>{question.choices.map((item, index) => <label className={choice === index ? "selected" : ""} key={item.label}><input type="radio" name="guideline-answer" checked={choice === index} onChange={() => { setChoice(index); setCustom(""); setPreview(item.body); }} /><span><strong>{item.label}</strong><small>{item.body}</small></span>{choice === index && <Check size={18} />}</label>)}<label className={choice === -1 ? "selected" : ""}><input type="radio" name="guideline-answer" checked={choice === -1} onChange={() => { setChoice(-1); setPreview(composeGuidelineAnswer(question, -1, custom)); }} /><span><strong>Write my own answer</strong></span></label></fieldset>}
        <label className="guide-answer-label">{choice >= 0 ? "Add details or exceptions" : "Your answer"}<Textarea disabled={!ready || publishing} rows={3} maxLength={4000} value={custom} onChange={e => { setCustom(e.target.value); if (choice === -2) setChoice(-1); setPreview(composeGuidelineAnswer(question, choice, e.target.value)); }} /></label>
        <label className="guide-answer-label">Category<select className="guide-topic-select" value={answerCategory} onChange={e => setAnswerCategory(e.target.value)}>{[...new Set([...GUIDELINE_TOPICS, "General", answerCategory])].map(item => <option key={item}>{item}</option>)}</select></label>
        {preview.trim() && <section className="guide-answer-preview"><div><span>Guideline preview · editable</span><Badge variant="secondary">{answerCategory}</Badge></div><h4>{question.title}</h4><Textarea aria-label="Guideline preview" maxLength={5000} rows={4} value={preview} onChange={e => setPreview(e.target.value)} /><p>Formatting is cleaned up automatically. Keep your instructions, exceptions, and decisions accurate before saving.</p></section>}
        <div className="guide-question-actions"><Button variant="outline" onClick={defer}><SkipForward size={16} /> Save for later</Button><Button disabled={!ready || publishing || !preview.trim()} onClick={saveAnswer}>Save answer & next <ArrowRight size={16} /></Button></div>
      </>}
      {(error || notice) && <p className={`guide-manager-message ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{error || notice}</p>}
      <div className="guide-interview-footer"><div><strong>{ready ? saveStatus : "Opening your draft…"}</strong><span>{unsavedAnswer ? "Save this answer before publishing. Unfinished text is not saved." : "Published answers appear in everyone's guidelines. Saved drafts stay private until published."}</span></div><Button variant="outline" disabled={publishing} onClick={() => onOpenChange(false)}>Close</Button><Button disabled={!ready || publishing || !changeCount || draft.conflicts.length > 0 || unsavedAnswer} onClick={publish}>{publishing ? "Preparing…" : `Publish saved answers (${changeCount})`}</Button></div>
    </>}
  </DialogContent></Dialog>;
}
