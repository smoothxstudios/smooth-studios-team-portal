"use client";

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Download,
  FileText,
  MessageCircleQuestion,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Tags,
  Trash2,
  Upload,
} from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GuidelineInterview } from "@/components/guideline-interview";
import { GUIDELINE_TOPICS, organizeGuideline, needsGuidelineAnswer, topicOrder } from "@/lib/guideline-content.mjs";
import { guidelineQuestions, questionState, submittedEntryId } from "@/lib/guideline-queue.mjs";
import { searchGuidelines } from "@/lib/guideline-search.mjs";
import { MAX_GUIDELINES } from "@/lib/studio-guidelines.mjs";
import { teamRequest, type GuidelineQuestionRequest } from "@/lib/team-api";
import type { StudioGuideline, StudioRulebook } from "@/lib/dashboard-types";

const MAX_ENTRIES = MAX_GUIDELINES;
const EMPTY_FIELDS = { title: "", category: "General", body: "", tags: "" };
const CATEGORY_SUGGESTIONS = [...GUIDELINE_TOPICS, "General"];

function newGuidelineId() {
  return `guide-${crypto.randomUUID()}`;
}

function filenameTitle(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Imported guideline";
}

function importedEntry(value: unknown, index: number, preserveId = false): StudioGuideline {
  if (!value || typeof value !== "object") throw new Error(`Imported guideline ${index + 1} is invalid.`);
  const record = value as Record<string, unknown>;
  const title = String(record.title ?? record.question ?? "").trim();
  const body = String(record.body ?? record.content ?? record.answer ?? "").replace(/\r\n?/g, "\n").trim();
  const category = String(record.category ?? "General").trim() || "General";
  const rawTags = Array.isArray(record.tags) ? record.tags : typeof record.tags === "string" ? record.tags.split(",") : [];
  const tags = [...new Set(rawTags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 8);
  if (!title || !body) throw new Error(`Imported guideline ${index + 1} needs both a title and instructions.`);
  if (title.length > 120 || category.length > 50 || body.length > 5_000 || tags.some((tag) => tag.length > 30)) {
    throw new Error(`Imported guideline ${index + 1} exceeds a field limit.`);
  }
  const id = preserveId && typeof record.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(record.id) ? record.id : newGuidelineId();
  return { id, title, category, body, tags };
}

function parseMarkdown(text: string, fileName: string) {
  const entries: StudioGuideline[] = [];
  let category = "General";
  let title = "";
  let body: string[] = [];

  const flush = () => {
    const content = body.join("\n").trim();
    if (title && content) entries.push(importedEntry({ title, category, body: content }, entries.length));
    title = "";
    body = [];
  };

  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const section = line.match(/^#\s+(.+)$/);
    const guideline = line.match(/^##\s+(.+)$/);
    if (section) {
      flush();
      category = section[1].trim() || "General";
    } else if (guideline) {
      flush();
      title = guideline[1].trim();
    } else {
      body.push(line);
    }
  }
  flush();
  if (entries.length) return entries;
  const content = body.join("\n").trim() || text.trim();
  return content ? [importedEntry({ title: filenameTitle(fileName), category, body: content }, 0)] : [];
}

function parseImportedFile(file: File, text: string) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "json") {
    const parsed = JSON.parse(text) as unknown;
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown[] }).entries)
        ? (parsed as { entries: unknown[] }).entries
        : null;
    if (!values) throw new Error("JSON imports must be an array or an object with an entries array.");
    const preserveIds = Boolean(parsed && typeof parsed === "object" && (parsed as { kind?: string }).kind === "studio-guidelines-review");
    return values.map((value, index) => importedEntry(value, index, preserveIds));
  }
  if (extension === "md" || extension === "markdown") return parseMarkdown(text, file.name);
  return text.trim() ? [importedEntry({ title: filenameTitle(file.name), category: "General", body: text }, 0)] : [];
}

function formattedUpdatedAt(value: string | null | undefined) {
  if (!value) return "Not published yet";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function StudioGuidePage({
  rulebook,
  isOwner,
  draftPassword,
  teamToken,
  onPublish,
}: {
  rulebook?: StudioRulebook;
  isOwner: boolean;
  draftPassword: string;
  teamToken: string;
  onPublish: (entries: StudioGuideline[]) => Promise<void>;
}) {
  const entries = useMemo<StudioGuideline[]>(() => (rulebook?.entries ?? []).map(organizeGuideline), [rulebook]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [managerOpen, setManagerOpen] = useState(false);
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [draft, setDraft] = useState<StudioGuideline[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [requests, setRequests] = useState<GuidelineQuestionRequest[]>([]);
  const [queueError, setQueueError] = useState("");
  const [askOpen, setAskOpen] = useState(false), [questionText, setQuestionText] = useState("");
  const [asking, setAsking] = useState(false), [askNotice, setAskNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const reloadQuestions = useCallback(async () => {
    if (!teamToken) return;
    try {
      const result = await teamRequest<{ questions: GuidelineQuestionRequest[] }>(teamToken, "/guidelines/questions");
      setRequests(result.questions); setQueueError("");
    } catch { setQueueError("The shared question queue could not be reached. Saved guidelines and suggested questions are still available."); }
  }, [teamToken]);
  useEffect(() => {
    void reloadQuestions();
    const refresh = () => { if (!document.hidden) void reloadQuestions(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [reloadQuestions]);
  useEffect(() => { if (interviewOpen) void reloadQuestions(); }, [interviewOpen, reloadQuestions]);
  useEffect(() => {
    if (!isOwner || !teamToken) return;
    const answered = requests.filter(row => row.status === "open" && entries.some(entry => entry.id === submittedEntryId(row.id) && !needsGuidelineAnswer(entry.body)));
    if (!answered.length) return;
    void Promise.allSettled(answered.map(row => teamRequest(teamToken, `/guidelines/questions/${row.id}`, { status: "answered" }, "PATCH").then(() => row.id))).then(results => {
      const completed = new Set(results.filter(result => result.status === "fulfilled").map(result => result.value));
      if (completed.size) setRequests(current => current.map(row => completed.has(row.id) ? { ...row, status: "answered" } : row));
    });
  }, [isOwner, teamToken, entries, requests]);

  const addQuestion = async (question: string) => {
    if (!teamToken) throw new Error("Sign in again to add a shared question.");
    await teamRequest(teamToken, "/guidelines/questions", { question: question.trim() });
    await reloadQuestions();
  };
  const submitQuestion = async () => {
    setAsking(true); setAskNotice("");
    try { await addQuestion(questionText); setQuestionText(""); setAskNotice("Added to Smooth's question queue. The answer will appear in Studio Guidelines after it is published."); }
    catch (caught) { setAskNotice(caught instanceof Error ? caught.message : "Could not add this question."); }
    finally { setAsking(false); }
  };
  const exportAnswers = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ kind: "studio-guidelines-review", version: 1, updatedAt: rulebook?.updatedAt, entries }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "Smooth-Studios-Guidelines.json"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  useEffect(() => {
    const openQuestions = () => { if (isOwner && window.location.hash === "#guidelines-questions") setInterviewOpen(true); };
    openQuestions();
    window.addEventListener("hashchange", openQuestions);
    return () => window.removeEventListener("hashchange", openQuestions);
  }, [isOwner]);

  const answeredEntries = useMemo(() => entries.filter(entry => !needsGuidelineAnswer(entry.body)), [entries]);
  const categories = useMemo(() => [...new Set(answeredEntries.map(entry => entry.category))].sort(topicOrder), [answeredEntries]);
  const searchResults = useMemo<{ entry: StudioGuideline; snippet: string; score: number }[]>(() => searchGuidelines(entries, query), [entries, query]);
  const visibleResults = searchResults.filter(result => category === "All" || result.entry.category === category);
  const pendingCount = guidelineQuestions(entries, requests).filter(question => questionState(question, entries, entries) === "unanswered").length;

  const resetEditor = () => {
    setEditingId(null);
    setFields(EMPTY_FIELDS);
    setError("");
  };

  const openManager = () => {
    setDraft(entries.map((entry) => ({ ...entry, tags: [...entry.tags] })));
    setNotice("");
    resetEditor();
    setManagerOpen(true);
  };

  const editGuideline = (entry: StudioGuideline) => {
    setEditingId(entry.id);
    setFields({ title: entry.title, category: entry.category, body: entry.body, tags: entry.tags.join(", ") });
    setError("");
  };

  const saveDraft = (event: FormEvent) => {
    event.preventDefault();
    const title = fields.title.trim();
    const categoryValue = fields.category.trim() || "General";
    const body = fields.body.replace(/\r\n?/g, "\n").trim();
    const tags = [...new Set(fields.tags.split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 8);
    if (!title || !body) {
      setError("Add both a title and the instructions before saving.");
      return;
    }
    if (tags.some((tag) => tag.length > 30)) {
      setError("Each search tag must be 30 characters or fewer.");
      return;
    }
    if (!editingId && draft.length >= MAX_ENTRIES) {
      setError(`Studio Guidelines supports up to ${MAX_ENTRIES} entries.`);
      return;
    }
    const next = { id: editingId ?? newGuidelineId(), title, category: categoryValue, body, tags };
    setDraft((current) => editingId ? current.map((entry) => entry.id === editingId ? next : entry) : [...current, next]);
    setNotice(editingId ? "Guideline updated in this draft." : "Guideline added to this draft.");
    resetEditor();
  };

  const removeGuideline = (id: string) => {
    setDraft((current) => current.filter((entry) => entry.id !== id));
    if (editingId === id) resetEditor();
    setNotice("Guideline removed from this draft. Publish to make the change visible.");
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      if (file.size > 40_000) throw new Error("Import files must be smaller than 40 KB.");
      const imported = parseImportedFile(file, await file.text());
      if (!imported.length) throw new Error("That file did not contain any guideline text.");
      if (new Set(imported.map(entry => entry.id)).size !== imported.length) throw new Error("The file contains duplicate guideline IDs.");
      const incoming = new Map(imported.map(entry => [entry.id, entry]));
      const additions = imported.filter(entry => !draft.some(existing => existing.id === entry.id));
      if (draft.length + additions.length > MAX_ENTRIES) throw new Error(`The import would exceed the ${MAX_ENTRIES}-guideline limit.`);
      setDraft(current => [...current.map(entry => incoming.get(entry.id) ?? entry), ...additions]);
      setNotice(`Added ${additions.length} and updated ${imported.length - additions.length} guidelines from ${file.name}. Review the draft before publishing.`);
      editGuideline(imported[0]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The file could not be imported.");
    }
  };

  const publish = async () => {
    setError("");
    setPublishing(true);
    try {
      await onPublish(draft);
      setManagerOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Studio Guidelines could not be prepared.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <section className="guide-page">
      <article className="panel guide-hero">
        <div className="guide-hero-icon"><BookOpen /></div>
        <div className="guide-hero-copy">
          <p className="eyebrow">Studio operations</p>
          <h2>Studio Guidelines</h2>
          <p>Your shared reference for studio operations, team responsibilities, client care, equipment, rentals, and assignments.</p>
        </div>
        <div className="guide-hero-meta">
          <strong>{answeredEntries.length}</strong>
          <span>guideline{entries.length === 1 ? "" : "s"}</span>
          <small>Updated {formattedUpdatedAt(rulebook?.updatedAt)}</small>
        </div>
        {isOwner && <Button className="guide-manage-button" onClick={openManager}><Pencil size={16} /> Edit or import</Button>}
      </article>

      <div className="guide-utility-bar">{isOwner && <><Button variant="outline" onClick={() => setInterviewOpen(true)}><MessageCircleQuestion size={16} /> Questions to answer <Badge variant="secondary">{pendingCount}</Badge></Button><Button variant="ghost" onClick={exportAnswers}><Download size={16} /> Export answers</Button></>}<Button variant="ghost" onClick={() => { setQuestionText(query); setAskNotice(""); setAskOpen(true); }}><Plus size={16} /> Ask a question</Button></div>
      {queueError && <p className="guide-manager-message error" role="status">{queueError} <button type="button" onClick={() => void reloadQuestions()}>Retry</button></p>}

      <article className="panel guide-browser">
        <div className="guide-browser-head">
          <div className="guide-search"><Search size={18} /><Input aria-label="Search Studio Guidelines" maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder="Ask naturally: What if a client wants more time?" type="search" value={query} /></div>
          <p className="guide-search-hint">Search by question, keyword, or a similar phrase. Results come from your published guidelines.</p>
          {!query && <div className="guide-quick-search">{["Running late", "Extra time", "Trigger not working", "Polaroid", "Closing"].map(item => <button key={item} onClick={() => { setQuery(item); setCategory("All"); }} type="button">{item}</button>)}</div>}
          <div aria-label="Filter Studio Guidelines by category" className="guide-categories">
            {["All", ...categories].map((item) => <button aria-pressed={category === item} className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)} type="button">{item === "All" ? "All topics" : item} <span>{item === "All" ? answeredEntries.length : answeredEntries.filter(entry => entry.category === item).length}</span></button>)}
          </div>
        </div>

        {query.trim() && <div className="guide-search-summary" role="status"><span>{visibleResults.length} matching answer{visibleResults.length === 1 ? "" : "s"}{category !== "All" ? ` in ${category}` : ""}</span><button onClick={() => { setQuery(""); setCategory("All"); }} type="button">Clear search</button></div>}
        {visibleResults.length ? (
          <div className="guide-topic-groups">{(query.trim() ? ["Best matches"] : categories.filter(topic => category === "All" || topic === category)).map(topic => <section className="guide-topic-group" key={topic}><h3>{topic}</h3><Accordion className="guide-entries" type="multiple">
            {visibleResults.filter(result => query.trim() || result.entry.category === topic).map(({ entry, snippet }) => (
              <AccordionItem className="guide-entry" key={entry.id} value={entry.id}>
                <AccordionTrigger className="guide-entry-trigger">
                  <span className="guide-entry-title">{query.trim() && <Badge variant="secondary">{entry.category}</Badge>}<strong>{entry.title}</strong>{query.trim() && <span className="guide-result-snippet">{snippet}</span>}</span>
                </AccordionTrigger>
                <AccordionContent className="guide-entry-content">
                  <p>{entry.body}</p>
                  {entry.tags.length > 0 && <div className="guide-tags"><Tags size={14} />{entry.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion></section>)}</div>
        ) : (
          <div className="guide-empty">
            <FileText />
            <strong>{entries.length ? "No matching guidelines" : "Studio Guidelines is ready for its first entry"}</strong>
            <p>{entries.length ? "Try another phrase or add the missing question to Smooth's queue." : isOwner ? "Answer questions, add instructions, or import existing guidelines." : "Smooth has not published any studio guidelines yet."}</p>
            {category !== "All" && <Button variant="outline" onClick={() => setCategory("All")}>Search all topics</Button>}
            {query.trim() && <Button onClick={() => { setQuestionText(query); setAskNotice(""); setAskOpen(true); }}>Add this question to the queue</Button>}
            {!entries.length && isOwner && <Button onClick={openManager}><Plus size={16} /> Add first guideline</Button>}
          </div>
        )}
      </article>

      {isOwner && (
        <Dialog onOpenChange={setManagerOpen} open={managerOpen}>
          <DialogContent className="guide-manager-dialog">
            <DialogHeader>
              <p className="eyebrow">Smooth controls</p>
              <DialogTitle>Manage Studio Guidelines</DialogTitle>
              <DialogDescription>Add quick answers one at a time or import existing .txt, .md, or .json guidelines.</DialogDescription>
            </DialogHeader>

            <div className="guide-manager-toolbar">
              <input accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/json" aria-label="Import Studio Guidelines file" hidden onChange={importFile} ref={fileInput} type="file" />
              <Button onClick={() => fileInput.current?.click()} type="button" variant="outline"><Upload size={16} /> Import file</Button>
              <Button onClick={resetEditor} type="button" variant="outline"><Plus size={16} /> New guideline</Button>
              <span>{draft.length}/{MAX_ENTRIES} guidelines</span>
            </div>

            <div className="guide-manager-grid">
              <aside className="guide-draft-list">
                <div className="guide-draft-heading"><strong>Draft contents</strong><span>Changes publish together</span></div>
                {draft.length ? draft.map((entry) => (
                  <div className={`guide-draft-item ${editingId === entry.id ? "active" : ""}`} key={entry.id}>
                    <button onClick={() => editGuideline(entry)} type="button"><span>{entry.category}</span><strong>{entry.title}</strong></button>
                    <button aria-label={`Remove ${entry.title}`} className="guide-delete-button" onClick={() => removeGuideline(entry.id)} type="button"><Trash2 size={15} /></button>
                  </div>
                )) : <div className="guide-draft-empty">No guidelines in this draft yet.</div>}
              </aside>

              <form className="guide-editor" onSubmit={saveDraft}>
                <div className="guide-editor-heading"><div><strong>{editingId ? "Edit guideline" : "New guideline"}</strong><span>Write the answer the way you want the team to follow it.</span></div>{editingId && <Badge variant="secondary">Editing</Badge>}</div>
                <label>Question or title<Input maxLength={120} onChange={(event) => setFields((current) => ({ ...current, title: event.target.value }))} placeholder="Example: What should I check before a renter arrives?" value={fields.title} /></label>
                <label>Category<Input list="guide-category-suggestions" maxLength={50} onChange={(event) => setFields((current) => ({ ...current, category: event.target.value }))} placeholder="Rental preparation" value={fields.category} /></label>
                <datalist id="guide-category-suggestions">{CATEGORY_SUGGESTIONS.map((item) => <option key={item} value={item} />)}</datalist>
                <label>Instructions<Textarea maxLength={5_000} onChange={(event) => setFields((current) => ({ ...current, body: event.target.value }))} placeholder="Add clear steps, expectations, and what to do if something goes wrong." rows={8} value={fields.body} /></label>
                <label>Search tags <span>(optional, separated by commas)</span><Input onChange={(event) => setFields((current) => ({ ...current, tags: event.target.value }))} placeholder="lights, arrival, cleanup" value={fields.tags} /></label>
                <div className="guide-editor-actions"><Button type="submit">{editingId ? "Save changes" : "Add to draft"}</Button>{editingId && <Button onClick={resetEditor} type="button" variant="ghost">Stop editing</Button>}</div>
              </form>
            </div>

            {(error || notice) && <div className={`guide-manager-message ${error ? "error" : ""}`}>{error || notice}</div>}
            <div className="guide-security-note"><ShieldAlert /><p><strong>Keep private access details out of the guide.</strong> Do not include passwords, alarm codes, door codes, or customer information.</p></div>
            <DialogFooter>
              <Button disabled={publishing} onClick={() => setManagerOpen(false)} variant="outline">Cancel</Button>
              <Button className="workflow-run-button" disabled={publishing} onClick={publish}>{publishing ? "Encrypting…" : `Publish ${draft.length} guideline${draft.length === 1 ? "" : "s"}`}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {isOwner && draftPassword && <GuidelineInterview open={interviewOpen} onOpenChange={setInterviewOpen} rulebook={rulebook} password={draftPassword} onPublish={onPublish} requests={requests} onAddQuestion={addQuestion} />}
      <Dialog open={askOpen} onOpenChange={setAskOpen}><DialogContent className="guide-ask-dialog"><DialogHeader><DialogTitle>Ask a studio question</DialogTitle><DialogDescription>Your question goes to Smooth's queue. Once answered and published, the guideline will be available to the team.</DialogDescription></DialogHeader><label className="guide-answer-label">Question<Textarea rows={4} maxLength={300} placeholder="Describe the situation you need guidance on." value={questionText} onChange={e => setQuestionText(e.target.value)} /></label>{askNotice && <p role="status">{askNotice}</p>}<DialogFooter><Button variant="outline" onClick={() => setAskOpen(false)}>Close</Button><Button disabled={asking || questionText.trim().length < 8} onClick={submitQuestion}>{asking ? "Adding…" : "Add to question queue"}</Button></DialogFooter></DialogContent></Dialog>
    </section>
  );
}
