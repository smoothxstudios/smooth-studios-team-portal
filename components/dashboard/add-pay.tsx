"use client";
import { MoreOptions } from "@/components/dashboard/more-options";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { moneyInputCents } from "@/lib/creative-work.mjs";
import { studioLocal } from "@/lib/team-schedule.mjs";
import type { Employee } from "@/lib/dashboard-types";
import type { CreativeWorkState } from "@/lib/use-creative-work";
import { teamRequest } from "@/lib/team-api";
import { DEFAULT_PAY_WORK_TYPES, payWorkTypeLabel } from "@/lib/pay-work-types.mjs";

type WorkType = { id: string; label: string };

export function AddPay({ employees, state, token }: { employees: Employee[]; state: CreativeWorkState; token: string }) {
  const [id, setId] = useState<string | null>(null), [saved, setSaved] = useState(false);
  return <div className="manual-pay-action">
    {saved && <span role="status">Pay saved</span>}
    <Button onClick={() => { setSaved(false); setId(crypto.randomUUID()); }}><Plus size={17} />Add pay</Button>
    {id && <AddPayForm id={id} employees={employees} state={state} token={token} onClose={() => setId(null)} onSaved={() => { setSaved(true); setId(null); }} />}
  </div>;
}

function AddPayForm({ id, employees, state, token, onClose, onSaved }: { id: string; employees: Employee[]; state: CreativeWorkState; token: string; onClose: () => void; onSaved: () => void }) {
  const today = studioLocal(Date.now()).slice(0, 10);
  const [employeeId, setEmployeeId] = useState(""), [category, setCategory] = useState("");
  const [title, setTitle] = useState(""), [workDate, setWorkDate] = useState(today), [pay, setPay] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("owed"), [paidDate, setPaidDate] = useState(today);
  const [method, setMethod] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [options, setOptions] = useState<WorkType[]>(DEFAULT_PAY_WORK_TYPES);
  const [addingOption, setAddingOption] = useState(false), [optionName, setOptionName] = useState("");
  const [optionBusy, setOptionBusy] = useState(false), [optionError, setOptionError] = useState(""), [optionMessage, setOptionMessage] = useState("");
  useEffect(() => {
    let active = true;
    void teamRequest<{ options: WorkType[] }>(token, "/creative-work/work-types")
      .then(result => { if (active) setOptions(previous => [...new Map([...result.options, ...previous].map(item => [item.id, item])).values()]); })
      .catch(() => { if (active) setOptionError("Saved work types couldn’t load. Reopen Add pay to try again."); });
    return () => { active = false; };
  }, [token]);
  const saveOption = async () => {
    if (optionBusy) return;
    setOptionError(""); setOptionMessage("");
    try {
      const label = payWorkTypeLabel(optionName); setOptionBusy(true);
      const result = await teamRequest<{ option: WorkType; existing: boolean }>(token, "/creative-work/work-types", { label });
      setOptions(previous => [...previous.filter(item => item.id !== result.option.id), result.option]);
      setCategory(result.option.id); setAddingOption(false); setOptionName("");
      setOptionMessage(result.existing ? "Existing option selected." : "Option saved for future pay entries.");
    } catch (error) { setOptionError(error instanceof Error ? error.message : "The option couldn’t be saved."); }
    finally { setOptionBusy(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || optionBusy) return; setError("");
    const amountCents = moneyInputCents(pay);
    if (!employeeId || !category || !amountCents) { setError("Choose a person and work type, then enter the amount."); return; }
    setBusy(true);
    try { await state.addPay({ id, employeeId, category, title, workDate, amountCents, paymentStatus, paidDate, method, note }); onSaved(); }
    catch (error) { setError(error instanceof Error ? error.message : "Pay couldn’t be saved. Try again."); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy && !optionBusy) onClose(); }}><DialogContent closeDisabled={busy || optionBusy} className="creative-dialog manual-pay-dialog">
    <DialogHeader><DialogTitle>Add pay</DialogTitle><DialogDescription>Record onboarding, training, or other completed work.</DialogDescription></DialogHeader>
    <form className="manual-pay-form" onSubmit={submit}>
      <div className="manual-pay-scroll"><fieldset disabled={busy || optionBusy} className="creative-editor manual-pay-fields">
        <label>Team member<select aria-label="Team member" required value={employeeId} onChange={event => setEmployeeId(event.target.value)}><option value="" disabled>Choose a person</option>{employees.filter(person => !person.onboarding || person.accessReady).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <div className="pay-work-types"><label>Work type<select aria-label="Work type" required value={category} onChange={event => setCategory(event.target.value)}><option value="" disabled>Choose the work</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          {!addingOption && <Button type="button" variant="ghost" size="sm" onClick={() => { setAddingOption(true); setOptionMessage(""); }}><Plus size={15} />Add option</Button>}
          {addingOption && <div className="pay-work-type-editor"><label>New work type<Input autoFocus maxLength={60} value={optionName} placeholder="Event coverage, setup, editing…" onChange={event => setOptionName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void saveOption(); } }} /></label><div><Button type="button" size="sm" disabled={!optionName.trim() || optionBusy} onClick={() => void saveOption()}>{optionBusy ? "Saving option…" : "Save option"}</Button><Button type="button" variant="ghost" size="sm" onClick={() => setAddingOption(false)}>Cancel option</Button></div><p className="creative-hint">Saved across your devices. Adding an option does not create pay.</p></div>}
          {optionError && <p className="creative-error" role="alert">{optionError}</p>}{optionMessage && <p className="creative-hint" role="status">{optionMessage}</p>}
        </div>
        {category === "other" && <label>Work description<Input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="Studio setup, equipment maintenance…" /></label>}
        <div className="creative-form-row"><label>Work date<Input required type="date" max={today} value={workDate} onChange={event => setWorkDate(event.target.value)} /></label><label>Amount (USD)<Input required inputMode="decimal" value={pay} onChange={event => setPay(event.target.value)} placeholder="0.00" /></label></div>
        <label>Payment status<select value={paymentStatus} onChange={event => setPaymentStatus(event.target.value)}><option value="owed">Still owed</option><option value="paid">Already paid</option></select></label>
        {paymentStatus === "paid" ? <><div className="creative-form-row"><label>Payment date<Input required type="date" max={today} value={paidDate} onChange={event => setPaidDate(event.target.value)} /></label><label>Payment method · optional<Input maxLength={80} value={method} onChange={event => setMethod(event.target.value)} placeholder="Cash, bank transfer…" /></label></div><p className="creative-hint">Records a payment you already made. This does not send money.</p></> : <p className="creative-hint">Adds to earned pay. Any remaining advance for this person applies first.</p>}
        <MoreOptions><label>Notes · optional<Textarea maxLength={4000} rows={2} value={note} onChange={event => setNote(event.target.value)} placeholder="What this pay covers" /></label></MoreOptions>
        {error && <p className="creative-error" role="alert">{error}</p>}
      </fieldset></div>
      <DialogFooter><Button type="button" variant="outline" disabled={busy || optionBusy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || optionBusy || addingOption || !employeeId || !category || !pay}>{busy ? "Saving…" : error ? "Try again" : "Save pay"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
