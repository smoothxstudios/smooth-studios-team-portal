"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { moneyInputCents } from "@/lib/creative-work.mjs";
import { studioLocal } from "@/lib/team-schedule.mjs";
import type { Employee } from "@/lib/dashboard-types";
import type { CreativeWorkState } from "@/lib/use-creative-work";

export function AddPay({ employees, state }: { employees: Employee[]; state: CreativeWorkState }) {
  const [id, setId] = useState<string | null>(null), [saved, setSaved] = useState(false);
  return <div className="manual-pay-action">
    {saved && <span role="status">Pay saved</span>}
    <Button onClick={() => { setSaved(false); setId(crypto.randomUUID()); }}><Plus size={17} />Add pay</Button>
    {id && <AddPayForm id={id} employees={employees} state={state} onClose={() => setId(null)} onSaved={() => { setSaved(true); setId(null); }} />}
  </div>;
}

function AddPayForm({ id, employees, state, onClose, onSaved }: { id: string; employees: Employee[]; state: CreativeWorkState; onClose: () => void; onSaved: () => void }) {
  const today = studioLocal(Date.now()).slice(0, 10);
  const [employeeId, setEmployeeId] = useState(""), [category, setCategory] = useState("");
  const [title, setTitle] = useState(""), [workDate, setWorkDate] = useState(today), [pay, setPay] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("owed"), [paidDate, setPaidDate] = useState(today);
  const [method, setMethod] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setError("");
    const amountCents = moneyInputCents(pay);
    if (!employeeId || !category || !amountCents) { setError("Choose a person and work type, then enter the amount."); return; }
    setBusy(true);
    try { await state.addPay({ id, employeeId, category, title, workDate, amountCents, paymentStatus, paidDate, method, note }); onSaved(); }
    catch (error) { setError(error instanceof Error ? error.message : "Pay couldn’t be saved. Try again."); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent closeDisabled={busy} className="creative-dialog manual-pay-dialog">
    <DialogHeader><DialogTitle>Add pay</DialogTitle><DialogDescription>Record onboarding, training, or other completed work.</DialogDescription></DialogHeader>
    <form className="manual-pay-form" onSubmit={submit}>
      <div className="manual-pay-scroll"><fieldset disabled={busy} className="creative-editor manual-pay-fields">
        <label>Team member<select required value={employeeId} onChange={event => setEmployeeId(event.target.value)}><option value="" disabled>Choose a person</option>{employees.filter(person => !person.onboarding || person.accessReady).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label>Work type<select required value={category} onChange={event => setCategory(event.target.value)}><option value="" disabled>Choose the work</option><option value="onboarding">Onboarding</option><option value="training">Training</option><option value="other">Other work</option></select></label>
        {category === "other" && <label>Work description<Input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="Studio setup, equipment maintenance…" /></label>}
        <div className="creative-form-row"><label>Work date<Input required type="date" max={today} value={workDate} onChange={event => setWorkDate(event.target.value)} /></label><label>Amount (USD)<Input required inputMode="decimal" value={pay} onChange={event => setPay(event.target.value)} placeholder="0.00" /></label></div>
        <label>Payment status<select value={paymentStatus} onChange={event => setPaymentStatus(event.target.value)}><option value="owed">Still owed</option><option value="paid">Already paid</option></select></label>
        {paymentStatus === "paid" ? <><div className="creative-form-row"><label>Payment date<Input required type="date" max={today} value={paidDate} onChange={event => setPaidDate(event.target.value)} /></label><label>Payment method · optional<Input maxLength={80} value={method} onChange={event => setMethod(event.target.value)} placeholder="Cash, bank transfer…" /></label></div><p className="creative-hint">Records a payment you already made. This does not send money.</p></> : <p className="creative-hint">Adds to earned pay. Any remaining advance for this person applies first.</p>}
        <label>Notes · optional<Textarea maxLength={4000} rows={2} value={note} onChange={event => setNote(event.target.value)} placeholder="What this pay covers" /></label>
        {error && <p className="creative-error" role="alert">{error}</p>}
      </fieldset></div>
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !employeeId || !category || !pay}>{busy ? "Saving…" : "Save pay"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
