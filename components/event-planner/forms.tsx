"use client";
import { MoreOptions } from "@/components/dashboard/more-options";
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogFooter } from '@/components/ui/dialog';
import { PlannerDialog, PlannerError } from './dialog';
import { hasPlannerOverride, plannerCoverageError } from '@/lib/event-planner.mjs';
import { plannerTimeText } from '@/lib/planner-time.mjs';
import type { PlannerEvent } from '@/lib/event-planner-types';
import type { createPlannerModel } from '@/lib/event-planner-model.mjs';
type EditorProps = {
    value: PlannerEvent | null;
    onChange: (value: PlannerEvent | null) => void;
    save: (event: PlannerEvent) => Promise<boolean>;
    busy: boolean;
    disabled: boolean;
    error: string;
};
export function EventEditor({ value: edit, onChange: setEdit, save, busy, disabled, error, isExisting }: EditorProps & {
    isExisting: boolean;
}) {
    return <PlannerDialog open={Boolean(edit)} onClose={() => setEdit(null)} busy={busy} title={isExisting ? 'Edit event' : 'Add event'} description="Event times, location and coverage notes for your staffing plan.">{edit && <form onSubmit={async (e) => { e.preventDefault(); if (await save(edit))
        setEdit(null); }}><div className="planner-form"><label>Event name<Input required maxLength={160} value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })}/></label><div className="schedule-form-pair"><label>Event starts<Input required type="datetime-local" value={edit.startLocal} onChange={e => setEdit({ ...edit, startLocal: e.target.value })}/></label><label>Event ends (optional)<Input type="datetime-local" value={edit.endLocal} onChange={e => setEdit({ ...edit, endLocal: e.target.value })}/></label></div><label>Crew needed<Input type="number" inputMode="numeric" min={edit.people.length} step={1} placeholder="Decide later" value={edit.crewNeeded || ''} onChange={e => setEdit({ ...edit, crewNeeded: Number(e.target.value) })}/></label><MoreOptions defaultOpen={Boolean(isExisting && (edit.notes || edit.archived))}><label>Location<Input maxLength={240} value={edit.location} onChange={e => setEdit({ ...edit, location: e.target.value })}/></label><label>Notes<textarea rows={3} maxLength={1500} value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })}/></label><label className="planner-check"><input type="checkbox" checked={edit.archived} onChange={e => setEdit({ ...edit, archived: e.target.checked })}/>Archive this event</label></MoreOptions></div><PlannerError error={error}/><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setEdit(null)}>Cancel</Button><Button type="submit" disabled={disabled}>{busy ? "Saving…" : error ? "Try again" : "Save event"}</Button></DialogFooter></form>}</PlannerDialog>;
}
export function CrewEditor({ value: crew, onChange: setCrew, save, busy, disabled, error, optionsFor }: EditorProps & {
    optionsFor: ReturnType<typeof createPlannerModel>['optionsFor'];
}) {
    const coverageError = crew ? plannerCoverageError(crew) : '';
    return <PlannerDialog open={Boolean(crew)} onClose={() => setCrew(null)} busy={busy} title="Plan crew" description={<>{crew?.title} · Choose the people you want covering this event.</>}>{crew && <form onSubmit={async (e) => { e.preventDefault(); if (await save(crew))
        setCrew(null); }}><div className="planner-form"><label>People needed<Input type="number" inputMode="numeric" min={Math.max(1, crew.people.length)} step={1} placeholder="Number of people" value={crew.crewNeeded || ''} required onChange={e => setCrew({ ...crew, crewNeeded: Number(e.target.value) })}/></label><div className="schedule-form-pair"><label>Coverage starts<Input type="datetime-local" value={crew.coverageStartLocal || crew.startLocal} onChange={e => setCrew({ ...crew, coverageStartLocal: e.target.value })}/></label><label>Coverage ends<Input type="datetime-local" value={crew.coverageEndLocal || crew.endLocal} onChange={e => setCrew({ ...crew, coverageEndLocal: e.target.value })}/></label></div><p className="planner-small">Set the crew’s actual hours to check overnight conflicts and check a shorter coverage window.</p><div className="planner-candidates">{(coverageError ? [] : [...optionsFor(crew)].sort((a,b)=>Number(b.id==='owner')-Number(a.id==='owner'))).map(p => { const checked = crew.people.includes(p.id), overridden = hasPlannerOverride(crew, p.id, p.fit), full = !crew.crewNeeded || crew.people.length >= crew.crewNeeded; return <div className={`planner-candidate ${p.fit.status}`} key={p.id}><label className="planner-candidate-main"><input aria-label={p.id === 'owner' ? 'Add myself (Smooth)' : p.name} type="checkbox" checked={checked} disabled={busy || (!checked && (p.fit.status === 'blocked' || full))} onChange={e => setCrew({ ...crew, people: e.target.checked ? [...crew.people, p.id] : crew.people.filter(id => id !== p.id), conflictOverrides: (crew.conflictOverrides || []).filter(a => a.personId !== p.id) })}/><span><b>{p.id === 'owner' ? 'Add myself (Smooth)' : p.name}{p.guest ? ' · guest' : ''}</b><small>{overridden ? 'Conflict overridden' : p.fit.label}</small>{p.id === 'owner' && <em>You join only when selected and saved.</em>}{p.fit.reasons.map((r: string) => <em key={r}>{plannerTimeText(r)}</em>)}</span>{p.fit.status === 'available' && <Check size={18}/>}</label>{p.fit.status === 'blocked' && !overridden && <Button type="button" size="sm" variant="outline" disabled={disabled || (!checked && full)} aria-label={`Override conflict and ${checked ? 'keep' : 'add'} ${p.name}`} onClick={() => setCrew({ ...crew, people: checked ? crew.people : [...crew.people, p.id], conflictOverrides: [...(crew.conflictOverrides || []).filter(a => a.personId !== p.id), { personId: p.id, key: p.fit.conflictKey }] })}>{checked ? 'Override & keep' : 'Override & add'}</Button>}</div>; })}</div></div><PlannerError error={coverageError || error}/><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setCrew(null)}>Cancel</Button><Button type="submit" disabled={disabled || Boolean(coverageError) || !crew.crewNeeded}>{busy ? "Saving…" : error ? "Try again" : "Save crew plan"}</Button></DialogFooter></form>}</PlannerDialog>;
}
