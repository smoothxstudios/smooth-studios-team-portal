"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Employee } from "@/lib/dashboard-types";
import { invitationEmails } from "@/lib/team-email-addresses.mjs";

type PaySetup = { type: "hourly" | "commission" | "pending"; hourlyCents?: number; rate?: number };
export type NewTeamSettings = { version: 1; employees: Record<string, { email: string; password: string; compensation: PaySetup }> };
type Row = { id: string; name: string; email: string; password: string; payType: PaySetup["type"]; rate: string };

function newPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `SS-${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function TeamAccountSetup({ open, onOpenChange, employees, busy, enabled, onSubmit }: {
  open: boolean; onOpenChange: (open: boolean) => void; employees: Employee[]; busy: boolean; enabled: boolean;
  onSubmit: (settings: NewTeamSettings) => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const prefill = new URLSearchParams(window.location.hash.startsWith("#setup-team?") ? window.location.hash.slice("#setup-team?".length) : "");
    setRows(previous => employees.filter(e => e.onboarding && !e.accessReady).map(e => previous.find(row => row.id === e.id) ?? {
      id: e.id, name: e.name, email: prefill.get(e.id) ?? e.email ?? "", password: newPassword(), payType: "pending", rate: "15",
    }));
    if (window.location.hash.startsWith("#setup-team")) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setError("");
  }, [open, employees]);
  const change = (id: string, values: Partial<Row>) => setRows(current => current.map(row => row.id === id ? { ...row, ...values } : row));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    try {
      const settings: NewTeamSettings = { version: 1, employees: {} };
      const emails = new Set();
      for (const row of rows) {
        const addresses: string[] = invitationEmails(row.email);
        if (!addresses.length || addresses.some(email => emails.has(email))) throw new Error("Each email address must belong to one person.");
        const email = addresses.join(", ");
        const rate = Number(row.rate);
        if (row.payType !== "pending" && (!Number.isFinite(rate) || rate <= 0 || rate > (row.payType === "commission" ? 100 : 1000))) throw new Error(`Check ${row.name}’s pay rate.`);
        settings.employees[row.id] = { email, password: row.password, compensation: row.payType === "hourly"
          ? { type: "hourly", hourlyCents: Math.round(rate * 100) }
          : row.payType === "commission" ? { type: "commission", rate: rate / 100 } : { type: "pending" } };
        addresses.forEach(address => emails.add(address));
      }
      await onSubmit(settings);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not prepare these accounts."); }
  };
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent className="schedule-modal team-account-setup">
    <DialogHeader><DialogTitle>Set up new team accounts</DialogTitle><DialogDescription>Check each email and choose their pay setup. Each person gets a private password you can view in Settings → Team logins after activation.</DialogDescription></DialogHeader>
    <form onSubmit={submit}>
      {rows.map(row => <fieldset className="team-account-fields" key={row.id} disabled={busy}><legend>{row.name}</legend>
        <label>Email addresses<input type="email" multiple autoComplete="off" required aria-describedby={`emails-help-${row.id}`} value={row.email} onChange={event => change(row.id, { email: event.target.value })} /></label>
        <p className="schedule-small" id={`emails-help-${row.id}`}>Separate addresses with commas. The first is the default for invitations; all addresses match this person’s Calendar assignments.</p>
        <div className="schedule-form-pair"><label>Pay setup<select value={row.payType} onChange={event => change(row.id, { payType: event.target.value as Row["payType"] })}>
          <option value="pending">Set pay rate later</option><option value="hourly">Hourly · studio rentals</option><option value="commission">Percentage of appointment price</option>
        </select></label>{row.payType !== "pending" && <label>{row.payType === "hourly" ? "Dollars per rental hour" : "Percentage"}<input type="number" min="0.01" max={row.payType === "commission" ? "100" : "1000"} step="0.01" inputMode="decimal" required value={row.rate} onChange={event => change(row.id, { rate: event.target.value })} /></label>}</div>
      </fieldset>)}
      {rows.some(row => row.payType === "pending") && <p className="schedule-small">Accounts with no rate can use scheduling and Studio Guidelines. Their earnings remain uncalculated until a rate is set.</p>}
      {!enabled && <p role="alert">Owner workflow access must be available to activate accounts.</p>}
      {error && <p className="login-error" role="alert">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy || !enabled || !rows.length}>{busy ? "Preparing…" : "Review accounts"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
