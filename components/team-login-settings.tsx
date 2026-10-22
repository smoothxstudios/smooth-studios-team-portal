"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DashboardPayload, Employee } from "@/lib/dashboard-types";

export function TeamLoginSettings({ employees, access }: { employees: Employee[]; access: DashboardPayload["teamAccess"] }) {
  const [open, setOpen] = useState(false);
  const [personId, setPersonId] = useState("");
  const [visible, setVisible] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const people = employees.filter(person => person.accessReady && access?.[person.id]?.password);
  const person = people.find(person => person.id === personId);
  const password = person ? access?.[person.id]?.password ?? "" : "";
  const reset = () => { setPersonId(""); setVisible(false); setNotice(""); setError(""); };
  const copy = async () => {
    if (!person || !password) return;
    setNotice(""); setError("");
    try {
      await navigator.clipboard.writeText(`Smooth Studios Dashboard\nhttps://dashboard.smoothstudios.co/\nAccount: ${person.name}\nPassword: ${password}`);
      setNotice("Login details copied.");
    } catch { setError("Could not copy. Choose Show password and copy the details manually."); }
  };
  return <section className="settings-card">
    <div className="settings-card-heading"><KeyRound size={23} /><div><h2>Team logins</h2><p>View private login details for activated team accounts.</p></div></div>
    <Button variant="outline" onClick={() => { reset(); setOpen(true); }}>View team logins</Button>
    <Dialog open={open} onOpenChange={value => { reset(); setOpen(value); }}>
      <DialogContent className="schedule-modal team-login-settings">
        <DialogHeader><DialogTitle>Team logins</DialogTitle><DialogDescription>Choose a person to view or copy their existing login. Share it privately with that person.</DialogDescription></DialogHeader>
        <label>Person<select value={personId} onChange={event => { reset(); setPersonId(event.target.value); }}>
          <option value="">Choose a person</option>
          {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select></label>
        {!people.length && <p>No activated team logins are available. Refresh the dashboard after account setup finishes.</p>}
        {person && <>
          <p>Account: <strong>{person.name}</strong></p>
          <label>Password<input type={visible ? "text" : "password"} value={password} readOnly autoComplete="off" spellCheck={false} /></label>
          <div className="quick-sign-in-actions"><Button variant="outline" onClick={() => setVisible(value => !value)}>{visible ? "Hide password" : "Show password"}</Button><Button onClick={() => void copy()}>Copy login details</Button></div>
        </>}
        {notice && <p role="status">{notice}</p>}
        {error && <p className="login-error" role="alert">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => { reset(); setOpen(false); }}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
