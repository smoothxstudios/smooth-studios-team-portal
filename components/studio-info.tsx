"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ClipboardCheck, Copy, Eye, EyeOff, Phone, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { teamRequest } from "@/lib/team-api";
import { TEAM } from "@/lib/team-schedule.mjs";

type InfoEntry = { id: string; category: string; label: string; value: string; note: string; kind: "text" | "secret" | "phone" | "link" };
type ChecklistItem = { id: string; phase: string; label: string };
type StudioReference = { revision: number; updatedAt: string | null; entries: InfoEntry[]; checklist: ChecklistItem[] };
type Progress = { version: number; checked: Record<string, { by: string; at: string }>; note: string; noteBy?: string; noteAt?: string };
type ChecklistRental = { id: string; checklistId: string; title: string; customer: string; start: string; end: string; progress: Progress };
type ChecklistData = { template: ChecklistItem[]; rentals: ChecklistRental[] };
const date = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const name = (id: string) => TEAM.find(person => person.id === id)?.name ?? id;

export function StudioInfoPage({ token, isOwner, initialTab = "reference", initialRentalId = "" }: { token: string; isOwner: boolean; initialTab?: "reference" | "checklists"; initialRentalId?: string }) {
  const [tab, setTab] = useState(initialTab), [data, setData] = useState<StudioReference | null>(null), [error, setError] = useState("");
  const [search, setSearch] = useState(""), [category, setCategory] = useState("all"), [editor, setEditor] = useState<InfoEntry | null>(null);
  const load = useCallback(async () => {
    try { const next = await teamRequest<StudioReference>(token, "/studio-reference"); setData(next); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "Studio information couldn’t load."); }
  }, [token]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const entries = data?.entries.filter(item => (category === "all" || item.category === category) &&
    `${item.label} ${item.category} ${item.note} ${item.kind === "secret" ? "" : item.value}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <section className="studio-info-page">
    <div className="studio-info-tabs" role="tablist" aria-label="Studio resources"><button role="tab" aria-selected={tab === "reference"} onClick={() => setTab("reference")}>Important info</button><button role="tab" aria-selected={tab === "checklists"} onClick={() => setTab("checklists")}><ClipboardCheck size={17} />Rental checklists</button></div>
    {tab === "reference" ? <>
      <div className="creative-heading"><div><h2>Important info</h2><p>Access details, contacts, prices, and quick answers.</p></div><div className="creative-toolbar-buttons"><Button variant="outline" size="sm" onClick={() => void load()} aria-label="Refresh studio information"><RefreshCw size={16} /></Button>{isOwner && data && <Button onClick={() => setEditor({ id: crypto.randomUUID(), category: "General", label: "", value: "", note: "", kind: "text" })}><Plus size={17} />Add info</Button>}</div></div>
      {error && <p className="creative-notice" role="alert">{error}</p>}
      <div className="creative-filters"><label className="creative-search"><Search size={17} /><span className="sr-only">Search important information</span><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search door, Wi-Fi, contacts…" /></label><label><span className="sr-only">Information category</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="all">All categories</option>{[...new Set(data?.entries.map(item => item.category))].map(value => <option key={value}>{value}</option>)}</select></label></div>
      {!data && !error && <p role="status">Loading studio information…</p>}
      {[...new Set(entries.map(item => item.category))].map(group => <section className="studio-info-group" key={group}><h3>{group}</h3><div className="studio-info-grid">{entries.filter(item => item.category === group).map(item => <InfoCard key={item.id} entry={item} onEdit={isOwner ? () => setEditor(item) : undefined} />)}</div></section>)}
      {data && !entries.length && <p className="creative-empty">{data.entries.length ? "No matching information. Try another word or category." : "Studio information is being prepared."}</p>}
      {data?.updatedAt && <p className="creative-hint">Updated {date(data.updatedAt)} Eastern</p>}
      {editor && data && <InfoEditor key={editor.id} entry={editor} data={data} token={token} onClose={() => setEditor(null)} onSave={load} />}
    </> : <RentalChecklists token={token} initialRentalId={initialRentalId} isOwner={isOwner} />}
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
    {!remove && <><label>Label<Input required maxLength={160} value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} /></label><div className="creative-form-row"><label>Category<Input required maxLength={80} value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })} /></label><label>Type<select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as InfoEntry["kind"] })}><option value="text">Text or price</option><option value="secret">Code or password</option><option value="phone">Phone number</option><option value="link">Website link</option></select></label></div><label>Value<Textarea required maxLength={6000} autoComplete="off" value={draft.value} onChange={event => setDraft({ ...draft, value: event.target.value })} /></label><label>Note · optional<Textarea maxLength={2000} value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} /></label></>}
    {error && <p className="login-error" role="alert">{error}</p>}<DialogFooter>{data.entries.some(item => item.id === entry.id) && !remove && <Button variant="ghost" disabled={busy} type="button" onClick={() => setRemove(true)}>Remove</Button>}<Button variant="outline" type="button" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy}>{busy ? "Saving…" : remove ? "Remove info" : "Save info"}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

function RentalChecklists({ token, initialRentalId, isOwner }: { token: string; initialRentalId: string; isOwner: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const [data, setData] = useState<ChecklistData | null>(null), [selectedId, setSelectedId] = useState(initialRentalId), [error, setError] = useState("");
  const [search, setSearch] = useState(""), [all, setAll] = useState(Boolean(initialRentalId)), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const result = await teamRequest<ChecklistData>(token, "/rental-checklists");
    setData(result);
    setSelectedId(current => current || [...result.rentals].filter(item => Date.parse(item.end) >= Date.now()).sort((a, b) => a.start.localeCompare(b.start))[0]?.id || "");
  }, [token]);
  useEffect(() => { const timer = window.setTimeout(() => void load().catch(error => setError(error.message)), 0); return () => window.clearTimeout(timer); }, [load]);
  const selected = data?.rentals.find(item => item.id === selectedId);
  const rentals = data?.rentals.filter(item => (all || Date.parse(item.end) > now - 7 * 86400_000) && `${item.customer} ${item.title} ${date(item.start)}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.start.localeCompare(b.start)) ?? [];
  const mutate = async (input: Record<string, unknown>) => {
    if (!selected || busy) return false;
    setBusy(true); setError("");
    try {
      const result = await teamRequest<{ progress: Progress }>(token, `/rental-checklists/${selected.checklistId}`, { ...input, version: selected.progress.version }, "PATCH");
      setData(current => current ? { ...current, rentals: current.rentals.map(item => item.checklistId === selected.checklistId ? { ...item, progress: result.progress } : item) } : current);
      return true;
    } catch (error) { setError(error instanceof Error ? error.message : "Checklist couldn’t be saved."); try { await load(); } catch { /* Keep last confirmed progress visible. */ } return false; }
    finally { setBusy(false); }
  };
  return <>
    <div className="creative-heading"><div><h2>Rental checklists</h2><p>{isOwner ? "Track preparation and closing for each studio rental." : "Your accepted rentals, with a checklist for each booking."}</p></div><Button variant="outline" disabled={busy} onClick={() => { setError(""); void load().catch(error => setError(error.message)); }}><RefreshCw size={16} />Refresh</Button></div>
    {error && <p className="creative-notice" role="alert">{error}</p>}
    <div className="creative-filters"><label className="creative-search"><Search size={17} /><span className="sr-only">Find a rental</span><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a rental or customer" /></label><label><span className="sr-only">Date range</span><select value={all ? "all" : "recent"} onChange={event => setAll(event.target.value === "all")}><option value="recent">Upcoming & recent</option><option value="all">All rentals</option></select></label></div>
    <label className="checklist-picker">Studio rental<select value={selectedId} onChange={event => { setSelectedId(event.target.value); setError(""); }}><option value="">Choose a rental</option>{selected && !rentals.some(item => item.id === selected.id) && <option value={selected.id}>{date(selected.start)} · {selected.customer} · {selected.title}</option>}{rentals.map(item => <option key={item.id} value={item.id}>{date(item.start)} · {item.customer} · {item.title}</option>)}</select></label>
    {!data && !error && <p role="status">Loading rental checklists…</p>}
    {data && !data.template.length && <p className="creative-empty">The rental checklist is being prepared.</p>}
    {selected && data && data.template.length > 0 && <ChecklistDetails key={selected.checklistId} rental={selected} template={data.template} busy={busy} mutate={mutate} />}
    {data && !selected && <div className="creative-empty"><ClipboardCheck size={28} /><p>{data.rentals.length ? "Choose a rental to start or continue its checklist." : "Your studio rentals will appear here once assigned and accepted."}</p></div>}
  </>;
}

function ChecklistDetails({ rental, template, busy, mutate }: { rental: ChecklistRental; template: ChecklistItem[]; busy: boolean; mutate: (input: Record<string, unknown>) => Promise<boolean> }) {
  const [noteDraft, setNoteDraft] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const note = noteDraft ?? rental.progress.note;
  const count = template.filter(item => rental.progress.checked[item.id]).length;
  return <article className="rental-checklist panel"><header><div><h3>{rental.customer || rental.title}</h3><p>{rental.title} · {date(rental.start)}–{date(rental.end)} Eastern</p></div><strong>{count}/{template.length} done</strong></header><progress value={count} max={template.length} aria-label="Rental checklist completion" />
    {[...new Set(template.map(item => item.phase))].map(phase => <section className="checklist-phase" key={phase}><h4>{phase}</h4>{template.filter(item => item.phase === phase).map(item => {
      const done = rental.progress.checked[item.id];
      return <label className={`rental-check-item${done ? " is-checked" : ""}`} key={item.id}><input type="checkbox" disabled={busy} checked={Boolean(done)} onChange={event => void mutate({ action: "check", itemId: item.id, checked: event.target.checked })} /><span>{item.label}{done && <small><Check size={12} />{name(done.by)} · {date(done.at)}</small>}</span></label>;
    })}</section>)}
    <form className="checklist-note creative-editor" onSubmit={async event => { event.preventDefault(); setSaved(false); if (await mutate({ action: "note", note })) { setNoteDraft(null); setSaved(true); } }}><label>Handoff notes · optional<Textarea maxLength={4000} value={note} onChange={event => { setNoteDraft(event.target.value); setSaved(false); }} placeholder="Lost items, equipment issues, or anything the next person should know." /></label><div><Button variant="outline" disabled={busy}>Save note</Button>{saved && <span role="status"> Note saved</span>}</div></form>
  </article>;
}
