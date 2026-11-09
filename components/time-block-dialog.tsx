"use client";
import { MoreOptions } from "@/components/dashboard/more-options";
import { AppPicker,ConfirmationRow } from "@/components/ui/app-controls";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TEAM,addLocalDays,studioLocal } from "@/lib/team-schedule.mjs";
import type { Dispatch,SetStateAction } from "react";
export type TimeBlockDraft = { userId: string; reason: string; startLocal: string; endLocal: string; repeatUntil: string; weekly: boolean };
export function TimeBlockDialog({ blockOpen, setBlockOpen, block, setBlock, busy, needsRefresh, isOwner, error, mutate }: {
  blockOpen: boolean; setBlockOpen: (value: boolean) => void; block: TimeBlockDraft;
  setBlock: Dispatch<SetStateAction<TimeBlockDraft>>; busy: boolean; needsRefresh: boolean; isOwner: boolean; error: string;
  mutate: (path: string, data: object) => Promise<boolean>;
}) {
  return (
    <Dialog open={blockOpen} onOpenChange={open => { if (!busy) setBlockOpen(open); }}><DialogContent presentation="sheet" closeDisabled={busy} className="schedule-modal app-task-sheet"><DialogHeader><DialogTitle>Block time</DialogTitle><DialogDescription>Choose when you can’t work. Accepted assignments stay in place.</DialogDescription></DialogHeader>
      <form className="app-sheet-form" onSubmit={async e => { e.preventDefault(); if (await mutate("/blocks", { ...block, repeatUntil: block.weekly ? block.repeatUntil : null })) setBlockOpen(false); }}>
        <div className="app-sheet-scroll">{isOwner && <AppPicker label="Team member" required placeholder="Choose a person" value={block.userId} disabled={busy} onValueChange={userId => setBlock({ ...block, userId })} options={TEAM.map(p => ({ value: p.id, label: p.name, color: p.color }))} />}
        <label>Reason<Input required maxLength={120} value={block.reason} onChange={e => setBlock({ ...block, reason: e.target.value })} placeholder="Reason for being unavailable" /></label>
        <div className="schedule-form-pair"><label>Starts<Input required type="datetime-local" value={block.startLocal} onChange={e => setBlock({ ...block, startLocal: e.target.value })} /></label><label>Ends<Input required type="datetime-local" value={block.endLocal} onChange={e => setBlock({ ...block, endLocal: e.target.value })} /></label></div>
        <MoreOptions><ConfirmationRow checked={block.weekly} disabled={busy} onCheckedChange={weekly => setBlock({ ...block, weekly })}>Repeat every week on this weekday</ConfirmationRow>
        {block.weekly && <><p className="schedule-small">For a class that already started, use its original meeting date. The series must include an upcoming meeting.</p><label>Last date of the class or series<Input required type="date" min={block.startLocal.slice(0, 10)} max={addLocalDays(block.startLocal || `${studioLocal(Date.now()).slice(0, 10)}T00:00`, 364).slice(0, 10)} value={block.repeatUntil} onChange={e => setBlock({ ...block, repeatUntil: e.target.value })} /></label></>}
        </MoreOptions>{error && <p className="schedule-error" role="alert">{error}</p>}
        </div><DialogFooter><Button disabled={busy} type="button" variant="outline" onClick={() => setBlockOpen(false)}>Cancel</Button><Button disabled={busy || needsRefresh} type="submit">{busy ? "Saving…" : error ? "Try again" : "Save"}</Button></DialogFooter>
      </form></DialogContent></Dialog>
  );
}
