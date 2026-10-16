"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Copy, Eye, EyeOff, Phone, Plus, RefreshCw, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { teamRequest } from "@/lib/team-api";
import { STUDIO_INFO_CATEGORIES, studioInfoEntries } from "@/lib/studio-reference.mjs";

type InfoEntry = { id: string; category: string; label: string; value: string; note: string; kind: "text" | "secret" | "phone" | "link" };
type ChecklistItem = { id: string; phase: string; label: string };
type StudioReference = { revision: number; updatedAt: string | null; entries: InfoEntry[]; checklist: ChecklistItem[] };
const date = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function StudioInfoPage({ token, isOwner, userId, section }: { token: string; isOwner: boolean; userId: string; section: "reference" | "checklists" }) {
  const [data, setData] = useState<StudioReference | null>(null), [error, setError] = useState("");
  const [search, setSearch] = useState(""), [category, setCategory] = useState("all"), [editor, setEditor] = useState<InfoEntry | null>(null);
  const load = useCallback(async () => {
    try { const next = await teamRequest<StudioReference>(token, "/studio-reference"); setData({ ...next, entries: studioInfoEntries(next.entries) }); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "Studio information couldn’t load."); }
  }, [token]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const entries = data?.entries.filter(item => (category === "all" || item.category === category) &&
    `${item.label} ${item.category} ${item.note} ${item.kind === "secret" ? "" : item.value}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <section className="studio-info-page">
    {error && <p className="creative-notice" role="alert">{error} <button onClick={() => void load()}>Try again</button></p>}
    {!data && !error && <p role="status">Loading studio information…</p>}
    {section === "reference" ? <>
      <div className="creative-heading"><div><h2>Studio info</h2><p>Contacts, access, and Wi-Fi in one place.</p></div><div className="creative-toolbar-buttons"><Button variant="outline" size="sm" onClick={() => void load()} aria-label="Refresh studio information"><RefreshCw size={16} /></Button>{isOwner && data && <Button onClick={() => setEditor({ id: crypto.randomUUID(), category: "Contacts", label: "", value: "", note: "", kind: "text" })}><Plus size={17} />Add info</Button>}</div></div>
      <div className="creative-filters"><label className="creative-search"><Search size={17} /><span className="sr-only">Search important information</span><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search door, Wi-Fi, contacts…" /></label><label><span className="sr-only">Information category</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="all">All categories</option>{STUDIO_INFO_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label></div>
      {STUDIO_INFO_CATEGORIES.filter(group => entries.some(item => item.category === group)).map(group => <section className="studio-info-group" key={group}><h3>{group}</h3><div className="studio-info-grid">{entries.filter(item => item.category === group).map(item => <InfoCard key={item.id} entry={item} onEdit={isOwner ? () => setEditor(item) : undefined} />)}</div></section>)}
      {data && !entries.length && <p className="creative-empty">{data.entries.length ? "No matching information. Try another word or category." : "Studio information is being prepared."}</p>}
      {data?.updatedAt && <p className="creative-hint">Updated {date(data.updatedAt)} Eastern</p>}
      {editor && data && <InfoEditor key={editor.id} entry={editor} data={data} token={token} onClose={() => setEditor(null)} onSave={load} />}
    </> : data && <RentalChecklist key={userId} template={data.checklist} userId={userId} />}
  </section>;
}

function InfoCard({ entry, onEdit }: { entry: InfoEntry; onEdit?: () => void }) {
  const [shown, setShown] = useState(false), [copied, setCopied] = useState(false), [error, setError] = useState("");
  return <article className="studio-info-card"><h4>{entry.label}</h4><div className={`studio-info-value${entry.kind === "secret" ? " is-secret" : ""}`}>{entry.kind === "secret" && !shown ? "••••••" : entry.kind === "link" ? <a href={entry.value} target="_blank" rel="noopener noreferrer">{entry.value}</a> : entry.value}</div>{entry.note && <p>{entry.note}</p>}<div className="studio-info-actions">
    {entry.kind === "secret" && <Button variant="outline" size="sm" onClick={() => setShown(value => !value)}>{shown ? <EyeOff size={15} /> : <Eye size={15} />}{shown ? "Hide" : "Show"}</Button>}
    <Button variant="ghost" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(entry.value); setCopied(true); setError(""); } catch { setShown(true); setError("Select and copy the value above."); } }}><Copy size={15} />{copied ? "Copied" : "Copy"}</Button>
    {entry.kind === "phone" && <a className="studio-call" href={`tel:${entry.value.replace(/[^+0-9]/g, "")}`}><Phone size={15} />Call</a>}
    {onEdit && <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>}
    </div>{error && <small role="status">{error}</small>}</article>;
}

function InfoEditor({ entry, data, token, onClose, onSave }: { entry: InfoEntry; data: StudioReference; token: string; onClose: () => void; onSave: () => Promise<void> }) {
  const [draft, setDraft] = useState(entry), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [remove, setRemove] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const entries = data.entries.filter(item => item.id !== draft.id);
      if (!remove) entries.push(draft);
      await teamRequest(token, "/studio-reference", { ...data, entries }, "PATCH");
      await onSave(); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : "Information couldn’t be saved."); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="creative-dialog"><DialogHeader><DialogTitle>{remove ? "Remove this information?" : "Studio information"}</DialogTitle><DialogDescription>{remove ? entry.label : "Visible to signed-in team members."}</DialogDescription></DialogHeader><form className="creative-editor" onSubmit={save}>
    {!remove && <><label>Label<Input required maxLength={160} value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} /></label><div className="creative-form-row"><label>Category<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}>{STUDIO_INFO_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label><label>Type<select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as InfoEntry["kind"] })}><option value="text">Text</option><option value="secret">Code or password</option><option value="phone">Phone number</option><option value="link">Website link</option></select></label></div><label>Value<Textarea required maxLength={6000} autoComplete="off" value={draft.value} onChange={event => setDraft({ ...draft, value: event.target.value })} /></label><label>Note · optional<Textarea maxLength={2000} value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} /></label></>}
    {error && <p className="login-error" role="alert">{error}</p>}<DialogFooter>{data.entries.some(item => item.id === entry.id) && !remove && <Button variant="ghost" disabled={busy} type="button" onClick={() => setRemove(true)}>Remove</Button>}<Button variant="outline" type="button" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy}>{busy ? "Saving…" : remove ? "Remove info" : "Save info"}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

function RentalChecklist({ template, userId }: { template: ChecklistItem[]; userId: string }) {
  const [checked, setChecked] = useState<string[]>([]), [ready, setReady] = useState(false);
  const storageKey = `smooth-rental-checklist:v1:${userId}`;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
        if (Array.isArray(saved)) setChecked(saved.filter((id): id is string => typeof id === "string"));
      } catch { /* The checklist remains usable when browser storage is unavailable. */ }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);
  const update = (next: string[]) => {
    setChecked(next);
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep progress in this view. */ }
  };
  const count = template.filter(item => checked.includes(item.id)).length;
  return <>
    <div className="creative-heading"><div><h2>Studio rental checklist</h2><p>Use this for any rental. Reset it before starting the next one.</p></div><Button variant="outline" disabled={!ready || !count} onClick={() => update([])}><RotateCcw size={16} />Reset checklist</Button></div>
    {!template.length ? <p className="creative-empty">The rental checklist is being prepared.</p> : <article className="rental-checklist panel">
      <header><div><h3><ClipboardCheck size={21} />Every rental</h3><p>Prepare the studio, welcome the client, and leave it ready for the next rental.</p></div><strong aria-live="polite">{count}/{template.length} done</strong></header>
      <progress value={count} max={template.length} aria-label="Rental checklist completion" />
      {[...new Set(template.map(item => item.phase))].map(phase => <section className="checklist-phase" key={phase}><h4>{phase}</h4>{template.filter(item => item.phase === phase).map(item => {
        const done = checked.includes(item.id);
        return <label className={`rental-check-item${done ? " is-checked" : ""}`} key={item.id}><input type="checkbox" disabled={!ready} checked={done} onChange={event => update(event.target.checked ? [...checked, item.id] : checked.filter(id => id !== item.id))} /><span>{item.label}</span></label>;
      })}</section>)}
      <p className="creative-hint">Your checks stay in this tab until you reset the list or close the tab.</p>
    </article>}
  </>;
}
