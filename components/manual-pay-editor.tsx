"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { studioLocal } from "@/lib/team-schedule.mjs";
import { moneyInputCents } from "@/lib/creative-work.mjs";
import type { CreativeAssignment } from "@/lib/use-creative-work";

export function ManualPayEditor({ item, busy, act }: { item: CreativeAssignment; busy: boolean; act: (input: Record<string, unknown>, item: CreativeAssignment) => Promise<boolean> }) {
  const [open, setOpen] = useState(false), [saved, setSaved] = useState(false);
  const [title, setTitle] = useState(item.title), [note, setNote] = useState(item.instructions);
  const [day, setDay] = useState(studioLocal(item.earnedAt ?? item.dueAt).slice(0, 10)), [pay, setPay] = useState((item.amountCents / 100).toFixed(2));
  return <section>{!open ? <><Button variant="outline" disabled={busy} onClick={() => { setTitle(item.title); setNote(item.instructions); setDay(studioLocal(item.earnedAt ?? item.dueAt).slice(0,10)); setPay((item.amountCents / 100).toFixed(2)); setSaved(false); setOpen(true); }}>Edit pay</Button>{saved && <p role="status">Pay updated</p>}</> : <form className="creative-editor" onSubmit={async e => { e.preventDefault(); if (await act({ action: "edit-manual", title, note, workDate: day, amountCents: moneyInputCents(pay) }, item)) { setOpen(false); setSaved(true); } }}>
    <h3>Edit pay</h3><label>Work description<Input required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></label>
    <label>Work date<Input required type="date" max={studioLocal(Date.now()).slice(0,10)} value={day} onChange={e => setDay(e.target.value)} /></label>
    <label>Amount (USD)<Input required inputMode="decimal" value={pay} onChange={e => setPay(e.target.value)} /></label>
    <label>Notes<Textarea maxLength={4000} value={note} onChange={e => setNote(e.target.value)} /></label>
    <p className="creative-hint">Recorded payments and applied advance credit are preserved. The amount cannot fall below them.</p>
    <div className="schedule-actions"><Button type="button" disabled={busy} variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy} type="submit">{busy ? "Saving…" : "Save changes"}</Button></div>
  </form>}</section>;
}
