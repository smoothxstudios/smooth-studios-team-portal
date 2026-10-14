"use client";

import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
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
import { GUIDELINE_CATEGORIES, GUIDELINE_QUESTIONS } from "@/lib/studio-guideline-questions.mjs";
import { generalGuidelineCategory, MAX_GUIDELINES } from "@/lib/studio-guidelines.mjs";
import type { StudioGuideline, StudioRulebook } from "@/lib/dashboard-types";

const MAX_ENTRIES = MAX_GUIDELINES;
const EMPTY_FIELDS = { title: "", category: "General", body: "", tags: "" };
const CATEGORY_SUGGESTIONS = [...GUIDELINE_CATEGORIES, "General"];

function newGuidelineId() {
  return `guide-${crypto.randomUUID()}`;
}

function filenameTitle(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Imported guideline";
}

function importedEntry(value: unknown, index: number): StudioGuideline {
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
  return { id: newGuidelineId(), title, category, body, tags };
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
    return values.map(importedEntry);
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
  onPublish,
}: {
  rulebook?: StudioRulebook;
  isOwner: boolean;
  draftPassword: string;
  onPublish: (entries: StudioGuideline[]) => Promise<void>;
}) {
  const entries = useMemo(() => (rulebook?.entries ?? []).map(entry => ({ ...entry, category: generalGuidelineCategory(entry.category) })), [rulebook]);
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
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const openQuestions = () => { if (isOwner && window.location.hash === "#guidelines-questions") setInterviewOpen(true); };
    openQuestions();
    window.addEventListener("hashchange", openQuestions);
    return () => window.removeEventListener("hashchange", openQuestions);
  }, [isOwner]);

  const categories = useMemo(() => [...new Set(entries.map((entry) => entry.category))].sort((a, b) => a.localeCompare(b)), [entries]);
  const visibleEntries = useMemo(() => {
    const search = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const inCategory = category === "All" || entry.category === category;
      const searchable = `${entry.title} ${entry.category} ${entry.body} ${entry.tags.join(" ")}`.toLowerCase();
      return inCategory && (!search || searchable.includes(search));
    });
  }, [category, entries, query]);

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
      if (draft.length + imported.length > MAX_ENTRIES) throw new Error(`The import would exceed the ${MAX_ENTRIES}-guideline limit.`);
      setDraft((current) => [...current, ...imported]);
      setNotice(`Imported ${imported.length} guideline${imported.length === 1 ? "" : "s"} from ${file.name}.`);
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
          <strong>{entries.length}</strong>
          <span>guideline{entries.length === 1 ? "" : "s"}</span>
          <small>Updated {formattedUpdatedAt(rulebook?.updatedAt)}</small>
        </div>
        {isOwner && <Button className="guide-manage-button" onClick={openManager}><Pencil size={16} /> Edit or import</Button>}
      </article>

      {isOwner && <article className="panel guide-interview-invite"><div className="guide-interview-invite-icon"><MessageCircleQuestion /></div><div><p className="eyebrow">Build it together</p><h3>Turn your answers into studio guidelines</h3><p>{GUIDELINE_QUESTIONS.length} suggested questions across {GUIDELINE_CATEGORIES.length} topics. Choose an answer or type your own, review the wording, and publish it for the team. Pick up where you left off on this device.</p></div><Button onClick={() => setInterviewOpen(true)}>Answer questions <Plus size={16} /></Button></article>}

      <article className="panel guide-browser">
        <div className="guide-browser-head">
          <div className="guide-search"><Search size={18} /><Input aria-label="Search Studio Guidelines" onChange={(event) => setQuery(event.target.value)} placeholder="Search a question, task, or keyword" type="search" value={query} /></div>
          <div aria-label="Filter Studio Guidelines by category" className="guide-categories">
            {["All", ...categories].map((item) => <button aria-pressed={category === item} className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)} type="button">{item}</button>)}
          </div>
        </div>

        {visibleEntries.length ? (
          <Accordion className="guide-entries" type="multiple">
            {visibleEntries.map((entry) => (
              <AccordionItem className="guide-entry" key={entry.id} value={entry.id}>
                <AccordionTrigger className="guide-entry-trigger">
                  <span className="guide-entry-title"><Badge variant="secondary">{entry.category}</Badge><strong>{entry.title}</strong></span>
                </AccordionTrigger>
                <AccordionContent className="guide-entry-content">
                  <p>{entry.body}</p>
                  {entry.tags.length > 0 && <div className="guide-tags"><Tags size={14} />{entry.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <div className="guide-empty">
            <FileText />
            <strong>{entries.length ? "No matching guidelines" : "Studio Guidelines is ready for its first entry"}</strong>
            <p>{entries.length ? "Try another search or choose All categories." : isOwner ? "Answer the suggested questions, add instructions, or import existing guidelines." : "Smooth has not published any studio guidelines yet."}</p>
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
      {isOwner && draftPassword && <GuidelineInterview open={interviewOpen} onOpenChange={setInterviewOpen} rulebook={rulebook} password={draftPassword} onPublish={onPublish} />}
    </section>
  );
}
