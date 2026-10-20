"use client";
import { MoreOptions } from "@/components/dashboard/more-options";

import { useState } from "react";
import { CalendarCheck, ChevronDown, Clock3, Pencil, Plus, Trash2 } from "lucide-react";
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
  const [expandedPerson, setExpandedPerson] = useState<string | null>(isOwner ? null : userId);
  const [showAllPreferences, setShowAllPreferences] = useState(false);
  const [showAllBlocks, setShowAllBlocks] = useState(false);
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
  const defaultUser = isOwner ? "" : userId;

  function selectPerson(personId: string) {
    setFilter(personId);
    setExpandedPerson(personId === "all" ? null : personId);
    setShowAllPreferences(false); setShowAllBlocks(false);
  }
  function togglePerson(personId: string) {
    setExpandedPerson(previous => previous === personId ? null : personId);
    setShowAllPreferences(false); setShowAllBlocks(false);
  }

  function edit(entry?: WorkPreference, personId = defaultUser) {
    setForm(entry ? { id: entry.id, userId: entry.userId, day: entry.startLocal.slice(0, 10), startTime: entry.allDay ? "12:00" : entry.startLocal.slice(11), endTime: entry.allDay ? "23:00" : entry.endLocal.slice(11), allDay: entry.allDay, weekly: Boolean(entry.repeatUntil), repeatUntil: entry.repeatUntil ?? "", note: entry.note } : initial(personId));
    setFormError(""); setOpen(true);
  }
  function details(entry: TimeBlock | WorkPreference) {
    const allDay = "allDay" in entry && entry.allDay;
    return <><p>{date(entry.startLocal)} · {allDay ? "Full day" : `${time(entry.startLocal)}–${time(entry.endLocal)}${entry.startLocal.slice(0, 10) !== entry.endLocal.slice(0, 10) ? ` (${date(entry.endLocal)})` : ""}`}</p><small>{entry.repeatUntil ? `Every ${new Date(localInstant(entry.startLocal)).toLocaleDateString("en-US", { timeZone: STUDIO_ZONE, weekday: "long" })} through ${date(`${entry.repeatUntil}T12:00`)}` : "One day"}{!upcoming(entry) ? " · Past" : ""}</small></>;
  }

  return <>
    <section className={`availability-panel${isOwner ? " schedule-panel is-owner" : " is-self"}`} aria-label={isOwner ? "Team availability" : "Your availability"}>
    <div className="schedule-toolbar availability-toolbar">
      {!isOwner && <p className="schedule-small">Visible to you and Smooth.</p>}
      {isOwner && <label className="schedule-filter">Team member<select value={filter} onChange={e => selectPerson(e.target.value)}><option value="all">Everyone</option>{TEAM.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    </div>
    <div className="availability-people">{(isOwner ? TEAM.filter(person => filter === "all" || person.id === filter) : [{ id: userId, name: name(userId), color: "" }]).map(person => {
      const personPreferences = preferences.filter(entry => entry.userId === person.id);
      const personBlocks = blocks.filter(entry => entry.userId === person.id);
      const expanded = !isOwner || expandedPerson === person.id;
      const previewPreferences = showAllPreferences ? personPreferences : personPreferences.slice(0, 3);
      const previewBlocks = showAllBlocks ? personBlocks : personBlocks.slice(0, 3);
      return <section className={`availability-person${isOwner ? " is-owner" : ""}`} key={person.id} aria-label={`${person.name} availability`}>
      {isOwner && <button type="button" className="availability-person-trigger" aria-expanded={expanded} aria-controls={`availability-details-${person.id}`} onClick={() => togglePerson(person.id)}><span className="employee-avatar" style={{ background: person.color }} aria-hidden="true">{person.name.slice(0, 1)}</span><span className="availability-person-name">{person.name}</span><span className="availability-person-counts"><span>{person.id === "owner" ? "Flexible" : `${personPreferences.length} preferred`}</span><span>{personBlocks.length} unavailable</span></span><ChevronDown size={18} aria-hidden="true" /></button>}
      {expanded && <div className="availability-person-details" id={`availability-details-${person.id}`}>
      <div className="availability-columns">
      <article className={isOwner ? "availability-section availability-preferred" : "schedule-panel availability-preferred"}><div className="schedule-section-heading"><h3><CalendarCheck size={isOwner ? 17 : 20} />{person.id === "owner" ? "Flexible schedule" : <>Want to work <span className="schedule-count">{personPreferences.length}</span></>}</h3>{!isOwner && <p>Tell Smooth which days or hours you would like to work. This is a preference; an assignment still needs to be offered and accepted.</p>}{person.id !== "owner" && <Button disabled={disabled || !available} onClick={() => edit(undefined, person.id)}><Plus size={16} />Add work preference</Button>}</div>
        {!available && person.id !== "owner" && <p className="schedule-warning" role="status">Work preferences are finishing setup. Refresh in a moment. Your time blocks are still available.</p>}
        {personPreferences.length ? <div className="schedule-blocks">{previewPreferences.map(p => <div className="schedule-block" key={p.id}><div><strong>{p.note || "Want to work"}</strong>{details(p)}</div><div className="availability-entry-actions"><Button disabled={disabled} size="icon" variant="outline" aria-label={`Edit work preference for ${name(p.userId)} on ${date(p.startLocal)}`} onClick={() => edit(p)}><Pencil size={16} /></Button><Button disabled={disabled} size="icon" variant="outline" aria-label={`Remove work preference for ${name(p.userId)} on ${date(p.startLocal)}`} onClick={() => setRemove({ path: `/work-preferences/${p.id}`, label: `${name(p.userId)}’s preferred work time on ${date(p.startLocal)}${p.repeatUntil ? " and its weekly repeats" : ""}` })}><Trash2 size={16} /></Button></div></div>)}</div> : <p className="schedule-empty">{person.id === "owner" ? "Your schedule is flexible. Add yourself to event plans as needed, and block time when you’re unavailable." : "No work preferences recorded."}</p>}
        {personPreferences.length > 3 && <button type="button" className="availability-show-more" onClick={() => setShowAllPreferences(value => !value)}>{showAllPreferences ? "Show less" : `Show ${personPreferences.length - 3} more`}</button>}
      </article>
      <article className={isOwner ? "availability-section" : "schedule-panel"}><div className="schedule-section-heading"><h3><Clock3 size={isOwner ? 17 : 20} />Unavailable <span className="schedule-count">{personBlocks.length}</span></h3>{!isOwner && <p>Block classes, another job, or personal time. Blocks flag scheduling conflicts and take priority over work preferences.</p>}<Button disabled={disabled} variant="outline" onClick={() => onBlockTime(person.id)}><Plus size={16} />Block time</Button></div>
        {personBlocks.length ? <div className="schedule-blocks">{previewBlocks.map(b => <div className="schedule-block" key={b.id}><div><strong>{b.reason}</strong>{details(b)}</div><Button aria-label={`Remove ${b.reason} block for ${name(b.userId)}`} size="icon" variant="outline" disabled={disabled} onClick={() => setRemove({ path: `/blocks/${b.id}`, label: `${b.reason}${b.repeatUntil ? " and all its weekly repeats" : ""} for ${name(b.userId)}` })}><Trash2 size={16} /></Button></div>)}</div> : <p className="schedule-empty">No blocked time recorded.</p>}
        {personBlocks.length > 3 && <button type="button" className="availability-show-more" onClick={() => setShowAllBlocks(value => !value)}>{showAllBlocks ? "Show less" : `Show ${personBlocks.length - 3} more`}</button>}
      </article>
    </div>
      </div>}
      </section>;
    })}</div>
    <label className="availability-past-toggle"><input type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} />Include past entries</label>
    <p className="schedule-small">No preference means no preference recorded. Existing assignments stay in place when availability changes; contact Smooth if you need an assignment changed.</p>
    </section>

    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent closeDisabled={busy} className="schedule-modal"><DialogHeader><DialogTitle>{form.id ? "Edit work preference" : "When do you want to work?"}</DialogTitle><DialogDescription>Choose a day or specific hours. Smooth uses this when assigning work.</DialogDescription></DialogHeader>
      <form onSubmit={async e => {
        e.preventDefault(); setFormError("");
        try {
          const startLocal = `${form.day}T${form.allDay ? "00:00" : form.startTime}`;
          let endLocal = form.allDay ? addLocalDays(`${form.day}T00:00`, 1) : `${form.day}T${form.endTime}`;
          if (!form.allDay && form.endTime < form.startTime) endLocal = addLocalDays(endLocal, 1);
          localInstant(startLocal); localInstant(endLocal);
          if (await mutate(form.id ? `/work-preferences/${form.id}` : "/work-preferences", { userId: form.userId, startLocal, endLocal, allDay: form.allDay, note: form.note, repeatUntil: form.weekly ? form.repeatUntil : null }, form.id ? "PATCH" : "POST")) { if (isOwner) { if (filter !== "all") setFilter(form.userId); setExpandedPerson(form.userId); setShowAllPreferences(false); setShowAllBlocks(false); } setOpen(false); }
        } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Check the selected date and hours."); }
      }}>
        {isOwner && <label>Team member<select aria-label="Team member" required disabled={Boolean(form.id)} value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}><option value="" disabled>Choose a person</option>{TEAM.filter(p => p.id !== "owner").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <label>Day<Input required type="date" value={form.day} onChange={e => setForm({ ...form, day: e.target.value })} /></label>
        <label className="schedule-check"><input type="checkbox" checked={form.allDay} onChange={e => setForm({ ...form, allDay: e.target.checked })} />Full day — any time that day</label>
        {!form.allDay && <><div className="schedule-form-pair"><label>From<Input required type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} /></label><label>Until<Input required type="time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} /></label></div>{form.endTime < form.startTime && <p className="schedule-small">Ends the following day.</p>}</>}
        <MoreOptions defaultOpen={Boolean(form.id && (form.weekly || form.note))}><label className="schedule-check"><input type="checkbox" checked={form.weekly} onChange={e => setForm({ ...form, weekly: e.target.checked })} />Repeat every week on this weekday</label>
        {form.weekly && <label>Repeat through<Input required type="date" min={form.day || undefined} max={form.day ? addLocalDays(`${form.day}T00:00`, 364).slice(0, 10) : undefined} value={form.repeatUntil} onChange={e => setForm({ ...form, repeatUntil: e.target.value })} /></label>}
        <label>Note (optional)<Input maxLength={120} placeholder="Open to extra rentals, prefer an afternoon shift…" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label></MoreOptions>
        {(formError || error) && <p className="schedule-error" role="alert">{formError || error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={disabled}>{busy ? "Saving…" : error || formError ? "Try again" : "Save preference"}</Button></DialogFooter>
      </form></DialogContent></Dialog>
    <Dialog open={Boolean(remove)} onOpenChange={value => { if (!busy && !value) setRemove(null); }}><DialogContent closeDisabled={busy} className="schedule-modal"><DialogHeader><DialogTitle>Remove availability entry?</DialogTitle><DialogDescription>Remove {remove?.label}? Existing assignments will stay in place.</DialogDescription></DialogHeader>{error && <p className="schedule-error" role="alert">{error}</p>}<DialogFooter><Button disabled={busy} variant="outline" onClick={() => setRemove(null)}>Keep entry</Button><Button disabled={disabled} onClick={async () => { if (remove && await mutate(remove.path, {}, "DELETE")) setRemove(null); }}>{busy ? "Removing…" : "Remove entry"}</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
