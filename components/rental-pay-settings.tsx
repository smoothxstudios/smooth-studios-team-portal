"use client";

import { useEffect, useRef, useState } from "react";
import { Banknote, Check, Pencil, RefreshCw } from "lucide-react";
import { PersonAvatar } from "@/components/team-profile";
import { AppPicker } from "@/components/ui/app-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Employee } from "@/lib/dashboard-types";
import { dollars, formatDate, formatTime } from "@/lib/dashboard-presentation";
import { rentalPayInput, sameRentalPay } from "@/lib/rental-pay-rates.mjs";
import { teamRequest } from "@/lib/team-api";

type Pay = NonNullable<Employee["compensation"]>;
type RateChange = { id: string; revision: number; effectiveAt: string; compensation: Pay };
type Rate = { employeeId: string; revision: number; compensation: Pay; effectiveAt: string | null; history: RateChange[] };
const rateLabel = (pay?: Pay) => pay?.type === "hourly" ? `${dollars(pay.hourlyCents, true)}/hour` : pay?.type === "commission" ? `${Math.round(pay.rate * 10000) / 100}% per rental` : "Rate needed";
const draftFor = (rate: Rate) => ({ employeeId: rate.employeeId, type: rate.compensation.type === "commission" ? "commission" : "hourly", amount: rate.compensation.type === "hourly" ? String(rate.compensation.hourlyCents / 100) : rate.compensation.type === "commission" ? String(Math.round(rate.compensation.rate * 10000) / 100) : "15" });

export function RentalPaySettings({ employees, token, active = true }: { employees: Employee[]; token: string; active?: boolean }) {
  const [rates, setRates] = useState<Rate[]>([]);
  const [draft, setDraft] = useState<ReturnType<typeof draftFor> | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const request = useRef<{ key: string; id: string } | null>(null);
  const saving = useRef(false);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    void teamRequest<{ rates: Rate[] }>(token, "/rental-pay-rates").then(result => {
      if (!Array.isArray(result.rates)) throw new Error("Rates could not load. Try again.");
      if (!cancelled) { setRates(result.rates); setError(""); }
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Rates could not load. Try again."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, active, reload]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving.current || loading) return;
    const current = rates.find(rate => rate.employeeId === draft.employeeId);
    if (!current) return;
    let compensation: Pay;
    try { compensation = rentalPayInput(draft.type, draft.amount); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Check the rate."); return; }
    if (sameRentalPay(current.compensation, compensation)) { setDraft(null); setMessage("This rate is already saved."); return; }
    const value = { employeeId: current.employeeId, revision: current.revision, compensation };
    const key = JSON.stringify(value);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    saving.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await teamRequest<{ saved: boolean; rate: Rate }>(token, "/rental-pay-rates", { ...value, id: request.current.id }, "PUT");
      if (!result.saved || result.rate?.employeeId !== current.employeeId) throw new Error("The save could not be confirmed. Try again.");
      setRates(previous => previous.map(rate => rate.employeeId === result.rate.employeeId ? result.rate : rate));
      request.current = null; setDraft(null);
      setMessage(`${employees.find(person => person.id === current.employeeId)?.name ?? "Team member"}’s rate is saved. Rental earnings update on the next sync.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The save could not be confirmed. Try again."); }
    finally { saving.current = false; setBusy(false); }
  }

  return <section className="settings-card rental-pay-settings">
    <div className="settings-card-heading"><Banknote size={23} aria-hidden="true" /><h2>Rental pay rates</h2></div>
    <p>Set an hourly rate or a percentage for each person’s studio rentals.</p>
    {message && <p role="status" className="schedule-success">{message}</p>}
    {error && !draft && <div className="schedule-error" role="alert"><p>{error}</p><Button variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={16} />Reload rates</Button></div>}
    {loading && !rates.length && <p role="status">Loading current rates…</p>}
    {!loading && !error && !rates.length && <div className="schedule-notice" role="status"><p>Rates are waiting for the studio sync. Reload shortly.</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>Reload rates</Button></div>}
    <ul>{employees.filter(person => person.accessReady !== false).map(person => {
      const rate = rates.find(value => value.employeeId === person.id);
      const pay = rate?.compensation ?? person.compensation;
      const editing = draft?.employeeId === person.id;
      return <li key={person.id} className="rental-pay-person">
        <div className="rental-pay-person-row"><PersonAvatar personId={person.id} name={person.name} /><div className="rental-pay-person-copy"><strong>{person.name}</strong><span>{rateLabel(pay)} {rate && pay?.type !== "pending" && <Check size={14} aria-label="Saved rate" />}</span></div><Button variant="outline" disabled={!rate || busy || loading} aria-label={`Edit ${person.name}’s rental pay rate`} onClick={() => { if (rate) { setDraft(draftFor(rate)); setError(""); setMessage(""); request.current = null; } }}><Pencil size={15} />Edit</Button></div>
        {editing && rate && <form className="rental-pay-editor" onSubmit={save} aria-label={`Edit ${person.name}’s rental pay rate`}>
          <div className="rental-pay-fields"><AppPicker label="Pay type" value={draft.type} disabled={busy} onValueChange={type => setDraft({ ...draft, type, amount: "" })} options={[{ value: "hourly", label: "Hourly" }, { value: "commission", label: "Percentage" }]} /><label>{draft.type === "hourly" ? "Dollars per hour" : "Percentage per rental"}<Input inputMode="decimal" required value={draft.amount} disabled={busy} onChange={event => setDraft({ ...draft, amount: event.target.value })} placeholder={draft.type === "hourly" ? "15.00" : "30"} /></label></div>
          <p className="schedule-small">Applies to rentals starting after you save. Earlier rentals keep their rate. Other work is unchanged.</p>
          {error && <div className="schedule-error" role="alert"><p>{error}</p><Button type="button" variant="outline" disabled={busy || loading} onClick={() => { request.current = null; setReload(value => value + 1); }}>Reload rates</Button></div>}
          <div className="rental-pay-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => { setDraft(null); setError(""); request.current = null; }}>Cancel</Button><Button type="submit" disabled={busy || loading} aria-busy={busy}>{busy ? "Saving…" : "Save rate"}</Button></div>
          {rate.history.length > 0 && <details className="rental-pay-history"><summary>Rate history</summary>{[...rate.history].reverse().slice(0, 10).map(change => <p key={change.id}><strong>{rateLabel(change.compensation)}</strong><span>{formatDate(change.effectiveAt)} · {formatTime(change.effectiveAt)}</span></p>)}</details>}
        </form>}
      </li>;
    })}</ul>
  </section>;
}
