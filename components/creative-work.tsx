"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Check, ClipboardList, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CREATIVE_STATUS, creativeEarningDate, creativeEarnings, creativeOwed, creativePaid, moneyInputCents } from "@/lib/creative-work.mjs";
import { studioLocal, TEAM } from "@/lib/team-schedule.mjs";
const teamAccent = (id: string) => TEAM.find(member => member.id === id)?.color ?? "#242428";
import type { Employee } from "@/lib/dashboard-types";
import type { CreativeAssignment, CreativeWorkState } from "@/lib/use-creative-work";

const dollars = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const date = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const name = (id: string) => TEAM.find(member => member.id === id)?.name ?? id;
const splitLinks = (value: string) => value.split(/\n/).map(link => link.trim()).filter(Boolean);
const openStatuses = ["offered", "accepted", "revision", "submitted"];
const status = (item: CreativeAssignment) => item.status === "approved" && creativeOwed(item) === 0 ? "Paid" : CREATIVE_STATUS[item.status];

function WorkLinks({ links }: { links: string[] }) {
  return <ul className="creative-links">{links.map((link, i) => <li key={link}><a href={link} target="_blank" rel="noopener noreferrer">{new URL(link).hostname} · Link {i + 1}<ArrowUpRight size={15} /></a></li>)}</ul>;
}

export function CreativeWorkPreview({ state, isOwner, onOpen }: { state: CreativeWorkState; isOwner: boolean; onOpen: () => void }) {
  const active = state.items.filter(item => openStatuses.includes(item.status));
  const review = active.filter(item => item.status === "submitted").length;
  if (!state.error && (state.loading || !active.length)) return null;
  return <button className="creative-home-link" onClick={onOpen}><ClipboardList size={22} /><span><strong>Creative work</strong><small>{state.error ? "Open to refresh assignments" : isOwner ? `${review} awaiting review · ${active.length} active assignments` : `${active.length} active assignment${active.length === 1 ? "" : "s"} · View your briefs and submissions`}</small></span><ArrowUpRight size={18} /></button>;
}

export function CreativeWorkPage({ state, employees, isOwner, earningsOnly = false, year }: { state: CreativeWorkState; employees: Employee[]; isOwner: boolean; earningsOnly?: boolean; year?: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const [search, setSearch] = useState(""), [filter, setFilter] = useState("active"), [person, setPerson] = useState("all");
  const [selected, setSelected] = useState<string | null>(null), [editor, setEditor] = useState<{ item?: CreativeAssignment; id: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const selectedItem = state.items.find(item => item.id === selected);
  const summary = creativeEarnings(state.items, year);
  const visible = (earningsOnly ? summary.items : state.items).filter(item => {
    if (earningsOnly) return item.status === "approved";
    return (person === "all" || item.employeeId === person) &&
      (filter === "all" || (filter === "active" ? openStatuses.includes(item.status) : filter === "closed" ? ["declined", "cancelled"].includes(item.status) : item.status === filter)) &&
      `${item.title} ${item.instructions} ${name(item.employeeId)}`.toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => earningsOnly ? creativeEarningDate(b).localeCompare(creativeEarningDate(a)) : a.dueAt.localeCompare(b.dueAt));
  const act = async (input: Record<string, unknown>, item: CreativeAssignment) => {
    setBusy(true); setError("");
    try { await state.mutate(input, item); return true; }
    catch (error) { setError(error instanceof Error ? error.message : "The change couldn’t be saved. Refresh before retrying."); return false; }
    finally { setBusy(false); }
  };
  return <section className={`creative-work${earningsOnly ? " creative-work-earnings panel" : ""}`}>
    <div className="creative-heading"><div><h2>{earningsOnly ? "Creative work payments" : "Creative work"}</h2><p>{earningsOnly ? "Approved work is included in your earnings totals above." : isOwner ? "Assign a deliverable, review the submission, and approve its pay." : "Your briefs, deadlines, submissions, and agreed pay."}</p></div><div className="creative-toolbar-buttons"><Button variant="outline" size="sm" onClick={() => void state.refresh()} aria-label="Refresh creative work"><RefreshCw size={16} /></Button>{isOwner && !earningsOnly && <Button onClick={() => { setEditor({ id: crypto.randomUUID() }); setError(""); }}><Plus size={17} />Assign work</Button>}</div></div>
    {state.error && <p className="creative-notice" role="alert">{state.loaded ? "Showing the last loaded creative work. " : "Creative work totals are unavailable. "}{state.error}</p>}
    {!earningsOnly && <>
      <div className="creative-totals"><div><span>Awaiting review</span><strong>{state.items.filter(item => item.status === "submitted").length}</strong></div><div><span>Approved · unpaid</span><strong>{dollars(summary.metrics.owed)}</strong></div><div><span>Paid</span><strong>{dollars(summary.metrics.paid)}</strong></div></div>
      <div className="creative-filters"><label className="creative-search"><Search size={17} /><span className="sr-only">Search creative work</span><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search assignments" /></label><label><span className="sr-only">Assignment status</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="active">Active work</option><option value="submitted">Awaiting review</option><option value="approved">Approved & paid</option><option value="closed">Declined & cancelled</option><option value="all">All work</option></select></label>{isOwner && <label><span className="sr-only">Employee</span><select value={person} onChange={event => setPerson(event.target.value)}><option value="all">Everyone</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>}</div>
    </>}
    {state.loading ? <p role="status">Loading creative work…</p> : <div className="creative-grid">{visible.map(item => <button className="creative-card" key={item.id} onClick={() => { setSelected(item.id); setError(""); }}>
      <div className="creative-card-top"><span className={`creative-status is-${item.status}`}>{status(item)}</span>{isOwner && <span className="creative-person"><i style={{ background: teamAccent(item.employeeId) }} />{name(item.employeeId)}</span>}</div>
      <h3>{item.title}</h3><p className={!earningsOnly && openStatuses.includes(item.status) && Date.parse(item.dueAt) < now ? "creative-overdue" : ""}>{earningsOnly ? `Approved ${date(item.approvedAt!)}` : `Due ${date(item.dueAt)}`}</p>
      <div className="creative-card-bottom"><strong>{dollars(item.amountCents)}</strong><span>{item.status === "approved" ? creativeOwed(item) ? `${dollars(creativeOwed(item))} owed` : "Paid in full" : "Earned after approval"}<ArrowUpRight size={16} /></span></div>
    </button>)}</div>}
    {!state.loading && !state.error && !visible.length && <div className="creative-empty"><ClipboardList size={26} /><h3>{earningsOnly ? "No approved creative work yet" : state.items.length ? "No assignments match" : "No creative assignments yet"}</h3><p>{earningsOnly ? "Approved assignments will appear here automatically." : isOwner ? "Create work such as an edit, photo selection, design, or social post." : "Smooth’s creative assignments will appear here with a brief, deadline, and agreed pay."}</p></div>}
    <Dialog open={Boolean(selectedItem)} onOpenChange={open => { if (!open && !busy) setSelected(null); }}><DialogContent className="creative-dialog"><DialogHeader><DialogTitle>{selectedItem?.title}</DialogTitle><DialogDescription>{selectedItem && `${name(selectedItem.employeeId)} · ${status(selectedItem)} · Due ${date(selectedItem.dueAt)}`}</DialogDescription></DialogHeader>
      {selectedItem && <WorkDetails key={selectedItem.id} item={selectedItem} isOwner={isOwner} busy={busy} error={error} act={act} onEdit={() => { setEditor({ id: selectedItem.id, item: selectedItem }); setSelected(null); }} />}
    </DialogContent></Dialog>
    {editor && <WorkEditor key={`${editor.id}-${editor.item?.version ?? 0}`} editor={editor} employees={employees} state={state} onClose={() => setEditor(null)} />}
  </section>;
}

function WorkDetails({ item, isOwner, busy, error, act, onEdit }: { item: CreativeAssignment; isOwner: boolean; busy: boolean; error: string; act: (input: Record<string, unknown>, item: CreativeAssignment) => Promise<boolean>; onEdit: () => void }) {
  const [action, setAction] = useState(""), [note, setNote] = useState(""), [links, setLinks] = useState(""), [pay, setPay] = useState(""), [method, setMethod] = useState("");
  const [validation, setValidation] = useState("");
  const owed = creativeOwed(item), paid = creativePaid(item);
  const show = (action: string) => { setAction(action); setValidation(""); setNote(""); setPay((owed / 100).toFixed(2)); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setValidation("");
    const input: Record<string, unknown> = { action, note };
    if (action === "submit") input.links = splitLinks(links);
    if (action === "pay") { const amount = moneyInputCents(pay); if (!amount || amount > owed) { setValidation("Enter an amount up to the remaining approved pay."); return; } input.amountCents = amount; input.method = method; }
    if (await act(input, item)) { setAction(""); setNote(""); setLinks(""); }
  };
  return <div className="creative-details">
    <div className="creative-totals"><div><span>Agreed pay</span><strong>{dollars(item.amountCents)}</strong></div><div><span>Paid</span><strong>{dollars(paid)}</strong></div><div><span>{item.status === "approved" ? "Owed" : "After approval"}</span><strong>{dollars(item.status === "approved" ? owed : openStatuses.includes(item.status) ? item.amountCents : 0)}</strong></div></div>
    <section><h3>Brief</h3><p className="creative-prose">{item.instructions}</p>{item.references.length > 0 && <WorkLinks links={item.references} />}</section>
    {item.submissions.length > 0 && <section><h3>Submissions</h3>{[...item.submissions].reverse().map((submission, index) => <div key={submission.id} className="creative-submission"><strong>{index === 0 ? "Latest submission" : "Earlier submission"} · {date(submission.submittedAt)}</strong><WorkLinks links={submission.links} />{submission.note && <p className="creative-prose">{submission.note}</p>}</div>)}</section>}
    {item.history.some(entry => entry.note) && <section><h3>Feedback</h3>{[...item.history].reverse().filter(entry => entry.note).map(entry => <div key={entry.id} className="creative-submission"><strong>{entry.event} · {date(entry.at)}</strong><p className="creative-prose">{entry.note}</p></div>)}</section>}
    {item.payments.length > 0 && <section><h3>Payment history</h3>{item.payments.map(payment => <p key={payment.id} className="creative-payment-line"><strong>{dollars(payment.amountCents)}</strong><span>{date(payment.paidAt)}{payment.method ? ` · ${payment.method}` : ""}</span></p>)}</section>}
    {!action && <div className="creative-actions">
      {!isOwner && item.status === "offered" && <><Button disabled={busy} onClick={() => void act({ action: "accept" }, item)}><Check size={17} />Accept assignment</Button><Button variant="outline" disabled={busy} onClick={() => show("decline")}>Decline</Button></>}
      {!isOwner && ["accepted", "revision"].includes(item.status) && <Button disabled={busy} onClick={() => show("submit")}>Submit work</Button>}
      {isOwner && item.status === "submitted" && <><Button disabled={busy} onClick={() => show("approve")}><Check size={17} />Approve work</Button><Button variant="outline" disabled={busy} onClick={() => show("revise")}>Request changes</Button></>}
      {isOwner && item.status === "approved" && owed > 0 && <Button disabled={busy} onClick={() => show("pay")}>Record payout</Button>}
      {isOwner && item.status === "offered" && <Button variant="outline" disabled={busy} onClick={onEdit}>Edit offer</Button>}
      {isOwner && openStatuses.includes(item.status) && <Button variant="ghost" disabled={busy} onClick={() => show("cancel")}>Cancel assignment</Button>}
    </div>}
    {action && <form className="creative-action-form" onSubmit={submit}>
      <h3>{{ submit: "Submit your work", approve: "Approve submitted work", revise: "Request changes", pay: "Record a payout", cancel: "Cancel this assignment?", decline: "Decline this assignment?" }[action]}</h3>
      {action === "submit" && <><p>Upload your files to the Content Vault or your sharing service, then add links Smooth can open.</p><label>Submission links · one per line<Textarea required maxLength={20500} value={links} onChange={event => setLinks(event.target.value)} placeholder="https://…" /></label><label>Submission notes · optional<Textarea maxLength={4000} value={note} onChange={event => setNote(event.target.value)} /></label></>}
      {action === "approve" && <p>Approving adds <strong>{dollars(item.amountCents)}</strong> to {name(item.employeeId)}’s earned, unpaid balance.</p>}
      {action === "revise" && <label>Feedback · optional<Textarea maxLength={4000} value={note} onChange={event => setNote(event.target.value)} placeholder="What should be adjusted?" /></label>}
      {action === "cancel" && <p>This closes the assignment. No earnings have been approved for it.</p>}
      {action === "decline" && <p>Smooth will see that you declined this offer.</p>}
      {action === "pay" && <><p>Record money you’ve already sent to {name(item.employeeId)}. This updates the payment record; it doesn’t transfer money.</p><label>Amount paid (USD)<Input required inputMode="decimal" value={pay} onChange={event => setPay(event.target.value)} /></label><label>Method or reference · optional<Input maxLength={80} placeholder="Apple Pay, cash, transfer…" value={method} onChange={event => setMethod(event.target.value)} /></label></>}
      {validation && <p className="login-error" role="alert">{validation}</p>}
      <div className="creative-actions"><Button disabled={busy} type="submit">{busy ? "Saving…" : ({ submit: "Send for review", approve: "Approve & add earnings", revise: "Send back for changes", pay: "Save payment record", cancel: "Cancel assignment", decline: "Decline offer" }[action])}</Button><Button disabled={busy} type="button" variant="outline" onClick={() => setAction("")}>Back</Button></div>
    </form>}
    {error && <p className="login-error" role="alert">{error}</p>}
    <details className="creative-history"><summary>Activity history</summary>{[...item.history].reverse().map(entry => <p key={entry.id}>{name(entry.by)} · {entry.event}<small>{date(entry.at)}</small></p>)}</details>
  </div>;
}

function WorkEditor({ editor, employees, state, onClose }: { editor: { id: string; item?: CreativeAssignment }; employees: Employee[]; state: CreativeWorkState; onClose: () => void }) {
  const item = editor.item;
  const activeEmployees = employees.filter(employee => !employee.onboarding || employee.accessReady);
  const [employeeId, setEmployeeId] = useState(item?.employeeId ?? activeEmployees[0]?.id ?? "");
  const [title, setTitle] = useState(item?.title ?? ""), [instructions, setInstructions] = useState(item?.instructions ?? "");
  const [due, setDue] = useState(item ? studioLocal(item.dueAt).slice(0, 16) : ""), [pay, setPay] = useState(item ? (item.amountCents / 100).toFixed(2) : "");
  const [references, setReferences] = useState(item?.references.join("\n") ?? ""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    const amountCents = moneyInputCents(pay);
    if (!amountCents) { setError("Enter a fixed payment amount with up to two decimal places."); return; }
    setBusy(true);
    try { await state.mutate({ id: editor.id, action: "edit", employeeId, title, instructions, dueLocal: due, amountCents, references: splitLinks(references) }, item); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : "Assignment couldn’t be saved."); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="creative-dialog"><DialogHeader><DialogTitle>{item ? "Edit creative offer" : "Assign creative work"}</DialogTitle><DialogDescription>A deliverable with a deadline and fixed pay. The deadline does not block their calendar.</DialogDescription></DialogHeader>
    <form className="creative-editor" onSubmit={submit}>
      <label>Assign to<select required disabled={Boolean(item)} value={employeeId} onChange={event => setEmployeeId(event.target.value)}>{activeEmployees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
      <label>Assignment title<Input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="Edit a recap video, retouch a photo set…" /></label>
      <label>Brief & deliverables<Textarea required maxLength={8000} rows={5} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="What should they make? Include format, length, style, and what a finished submission needs." /></label>
      <div className="creative-form-row"><label>Deadline<Input required type="datetime-local" value={due} onChange={event => setDue(event.target.value)} /></label><label>Agreed pay (USD)<Input required inputMode="decimal" value={pay} onChange={event => setPay(event.target.value)} placeholder="0.00" /></label></div>
      <label>Reference links · optional, one per line<Textarea maxLength={20500} value={references} onChange={event => setReferences(event.target.value)} placeholder="https://…" /></label>
      <p className="creative-hint">The employee accepts, submits their work, and earns the agreed amount when you approve it.</p>
      {error && <p className="login-error" role="alert">{error}</p>}
      <DialogFooter><Button disabled={busy} type="button" variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || !employeeId} type="submit">{busy ? "Saving…" : item ? "Save offer" : "Assign work"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
