"use client";

import { useState } from "react";
import { CalendarCheck, Clock3, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TEAM, STUDIO_ZONE, studioLocal, localInstant, addLocalDays, blockOccurrences } from "@/lib/team-schedule.mjs";
import type { TeamSchedule, WorkPreference, TimeBlock } from "@/lib/team-api";

const name = (id: string) => TEAM.find(p => p.id === id)?.name ?? id;
const date = (local: string) => new Date(localInstant(local)).toLocaleDateString("en-US", { timeZone: STUDIO_ZONE, weekday: "short", month: "short", day: "numeric" });
const time = (local: string) => new Date(localInstant(local)).toLocaleTimeString("en-US", { timeZone: STUDIO_ZONE, hour: "numeric", minute: "2-digit" });
const initial = (userId: string) => ({ id: "", userId, day: addLocalDays(studioLocal(Date.now()), 1).slice(0, 10), startTime: "12:00", endTime: "23:00", allDay: true, weekly: false, repeatUntil: "", note: "" });
const upcoming = (entry: TimeBlock | WorkPreference) => blockOccurrences(entry, new Date().toISOString(), new Date(Date.now() + 367 * 86400_000).toISOString()).length > 0;

export function TeamAvailability({ userId, isOwner, schedule, busy, needsRefresh, error, mutate, onBlockTime }: {
  userId: string; isOwner: boolean; schedule: TeamSchedule; busy: boolean; needsRefresh: boolean; error: string;
  mutate: (path: string, data: object, method?: string) => Promise<boolean>; onBlockTime: (id?: string) => void;
}) {
  const [filter, setFilter] = useState(isOwner ? "all" : userId);
  const [showPast, setShowPast] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => initial(userId));
  const [formError, setFormError] = useState("");
  const [remove, setRemove] = useState<{ path: string; label: string } | null>(null);
  const disabled = busy || needsRefresh;
  const available = schedule.availabilityVersion === 1;
  const visible = (entry: TimeBlock | WorkPreference) => (filter === "all" || entry.userId === filter) && (showPast || upcoming(entry));
  const preferences = (schedule.workPreferences ?? []).filter(visible).sort((a, b) => a.startLocal.localeCompare(b.startLocal));
  const blocks = schedule.blocks.filter(visible).sort((a, b) => a.startLocal.localeCompare(b.startLocal));
  const defaultUser = isOwner ? filter !== "all" && filter !== "owner" ? filter : "akiva" : userId;

  function edit(entry?: WorkPreference) {
    setForm(entry ? { id: entry.id, userId: entry.userId, day: entry.startLocal.slice(0, 10), startTime: entry.allDay ? "12:00" : entry.startLocal.slice(11), endTime: entry.allDay ? "23:00" : entry.endLocal.slice(11), allDay: entry.allDay, weekly: Boolean(entry.repeatUntil), repeatUntil: entry.repeatUntil ?? "", note: entry.note } : initial(defaultUser));
    setFormError(""); setOpen(true);
  }
  function details(entry: TimeBlock | WorkPreference) {
    const allDay = "allDay" in entry && entry.allDay;
    return <><p>{date(entry.startLocal)} · {allDay ? "Full day" : `${time(entry.startLocal)}–${time(entry.endLocal)}${entry.startLocal.slice(0, 10) !== entry.endLocal.slice(0, 10) ? ` (${date(entry.endLocal)})` : ""}`}</p><small>{entry.repeatUntil ? `Every ${new Date(localInstant(entry.startLocal)).toLocaleDateString("en-US", { timeZone: STUDIO_ZONE, weekday: "long" })} through ${date(`${entry.repeatUntil}T12:00`)}` : "One day"}{!upcoming(entry) ? " · Past" : ""}</small></>;
  }

  return <>
    <div className="schedule-toolbar">
      <p className="schedule-small">Visible to you and Smooth.</p>
      {isOwner && <label className="schedule-filter">Team member<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Everyone</option>{TEAM.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    </div>
    <div className="availability-columns">
      <article className="schedule-panel availability-preferred"><div className="schedule-section-heading"><h3><CalendarCheck size={20} />Want to work <span className="schedule-count">{preferences.length}</span></h3><p>{isOwner ? "Days and hours employees would like an assignment." : "Tell Smooth which days or hours you would like to work."} This is a preference; an assignment still needs to be offered and accepted.</p><Button disabled={disabled || !available} onClick={() => edit()}><Plus size={16} />Add work preference</Button></div>
        {!available && <p className="schedule-warning" role="status">Work preferences are finishing setup. Refresh in a moment. Your time blocks are still available.</p>}
        {preferences.length ? <div className="schedule-blocks">{preferences.map(p => <div className="schedule-block" key={p.id}><div>{isOwner && <span className="schedule-person"><i style={{ background: TEAM.find(person => person.id === p.userId)?.color }} />{name(p.userId)}</span>}<strong>{p.note || "Want to work"}</strong>{details(p)}</div><div className="availability-entry-actions"><Button disabled={disabled} size="icon" variant="outline" aria-label={`Edit work preference for ${name(p.userId)} on ${date(p.startLocal)}`} onClick={() => edit(p)}><Pencil size={16} /></Button><Button disabled={disabled} size="icon" variant="outline" aria-label={`Remove work preference for ${name(p.userId)} on ${date(p.startLocal)}`} onClick={() => setRemove({ path: `/work-preferences/${p.id}`, label: `${name(p.userId)}’s preferred work time on ${date(p.startLocal)}${p.repeatUntil ? " and its weekly repeats" : ""}` })}><Trash2 size={16} /></Button></div></div>)}</div> : <p className="schedule-empty">No work preferences for this view. Add a day or set up a weekly preference.</p>}
      </article>
      <article className="schedule-panel"><div className="schedule-section-heading"><h3><Clock3 size={20} />Unavailable <span className="schedule-count">{blocks.length}</span></h3><p>Block classes, another job, or personal time. Blocks flag scheduling conflicts and take priority over work preferences.</p><Button disabled={disabled} variant="outline" onClick={() => onBlockTime(filter === "all" ? undefined : filter)}><Plus size={16} />Block time</Button></div>
        {blocks.length ? <div className="schedule-blocks">{blocks.map(b => <div className="schedule-block" key={b.id}><div>{isOwner && <span className="schedule-person"><i style={{ background: TEAM.find(person => person.id === b.userId)?.color }} />{name(b.userId)}</span>}<strong>{b.reason}</strong>{details(b)}</div><Button aria-label={`Remove ${b.reason} block for ${name(b.userId)}`} size="icon" variant="outline" disabled={disabled} onClick={() => setRemove({ path: `/blocks/${b.id}`, label: `${b.reason}${b.repeatUntil ? " and all its weekly repeats" : ""} for ${name(b.userId)}` })}><Trash2 size={16} /></Button></div>)}</div> : <p className="schedule-empty">No blocked time for this view.</p>}
      </article>
    </div>
    <label className="availability-past-toggle"><input type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} />Include past entries</label>
    <p className="schedule-small">No preference means no preference recorded. Existing assignments stay in place when availability changes; contact Smooth if you need an assignment changed.</p>

    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="schedule-modal"><DialogHeader><DialogTitle>{form.id ? "Edit work preference" : "When do you want to work?"}</DialogTitle><DialogDescription>Choose a day or specific hours. Smooth uses this when assigning work.</DialogDescription></DialogHeader>
      <form onSubmit={async e => {
        e.preventDefault(); setFormError("");
        try {
          const startLocal = `${form.day}T${form.allDay ? "00:00" : form.startTime}`;
          let endLocal = form.allDay ? addLocalDays(`${form.day}T00:00`, 1) : `${form.day}T${form.endTime}`;
          if (!form.allDay && form.endTime < form.startTime) endLocal = addLocalDays(endLocal, 1);
          localInstant(startLocal); localInstant(endLocal);
          if (await mutate(form.id ? `/work-preferences/${form.id}` : "/work-preferences", { userId: form.userId, startLocal, endLocal, allDay: form.allDay, note: form.note, repeatUntil: form.weekly ? form.repeatUntil : null }, form.id ? "PATCH" : "POST")) { if (isOwner && filter !== "all") setFilter(form.userId); setOpen(false); }
        } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Check the selected date and hours."); }
      }}>
        {isOwner && <label>Team member<select disabled={Boolean(form.id)} value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>{TEAM.filter(p => p.id !== "owner").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <label>Day<Input required type="date" value={form.day} onChange={e => setForm({ ...form, day: e.target.value })} /></label>
        <label className="schedule-check"><input type="checkbox" checked={form.allDay} onChange={e => setForm({ ...form, allDay: e.target.checked })} />Full day — any time that day</label>
        {!form.allDay && <><div className="schedule-form-pair"><label>From<Input required type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} /></label><label>Until<Input required type="time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} /></label></div>{form.endTime < form.startTime && <p className="schedule-small">Ends the following day.</p>}</>}
        <label className="schedule-check"><input type="checkbox" checked={form.weekly} onChange={e => setForm({ ...form, weekly: e.target.checked })} />Repeat every week on this weekday</label>
        {form.weekly && <label>Repeat through<Input required type="date" min={form.day || undefined} max={form.day ? addLocalDays(`${form.day}T00:00`, 364).slice(0, 10) : undefined} value={form.repeatUntil} onChange={e => setForm({ ...form, repeatUntil: e.target.value })} /></label>}
        <label>Note (optional)<Input maxLength={120} placeholder="Open to extra rentals, prefer an afternoon shift…" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
        {(formError || error) && <p className="schedule-error" role="alert">{formError || error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={disabled}>{busy ? "Saving…" : "Save preference"}</Button></DialogFooter>
      </form></DialogContent></Dialog>
    <Dialog open={Boolean(remove)} onOpenChange={value => { if (!busy && !value) setRemove(null); }}><DialogContent className="schedule-modal"><DialogHeader><DialogTitle>Remove availability entry?</DialogTitle><DialogDescription>Remove {remove?.label}? Existing assignments will stay in place.</DialogDescription></DialogHeader>{error && <p className="schedule-error" role="alert">{error}</p>}<DialogFooter><Button disabled={busy} variant="outline" onClick={() => setRemove(null)}>Keep entry</Button><Button disabled={disabled} onClick={async () => { if (remove && await mutate(remove.path, {}, "DELETE")) setRemove(null); }}>Remove entry</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
