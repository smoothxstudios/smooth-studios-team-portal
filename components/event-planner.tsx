"use client";

import {useEffect,useMemo,useRef,useState} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight,Plus,Users,MapPin,Pencil,Upload,Download,RefreshCw,AlertTriangle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {DialogFooter} from '@/components/ui/dialog';
import {useEventPlanner} from '@/lib/use-event-planner';
import {createPlannerModel} from '@/lib/event-planner-model.mjs';
import {EventEditor,CrewEditor} from '@/components/event-planner/forms';
import {PlannerDateTimeField} from '@/components/event-planner/date-time-field';
import {PlannerDialog,PlannerError} from '@/components/event-planner/dialog';
import {studioLocal,localInstant,addLocalDays,blockOccurrences} from '@/lib/team-schedule.mjs';
import {emptyPlan,validatePlan,mergePlan,plannerOnDay,hasPlannerOverride} from '@/lib/event-planner.mjs';
import {plannerTimeText} from '@/lib/planner-time.mjs';
import type {PlannerData,PlannerEvent,PlannerAvailability} from '@/lib/event-planner-types';

const dayLabel=(day:string,options:Intl.DateTimeFormatOptions={weekday:'long',month:'long',day:'numeric'})=>new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US',{timeZone:'UTC',...options});
const clock=(v:string)=>v ? new Date(localInstant(v)).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',hour12:true}) : 'End TBD';
const windowLabel=(start:string,end:string)=>`${clock(start)}${end ? ` - ${clock(end)}${end.slice(0,10)!==start.slice(0,10) ? ` (${dayLabel(end.slice(0,10),{weekday:'short'})})` : ''}` : ' - end TBD'}`;
const today=()=>studioLocal(Date.now()).slice(0,10);
const plusDay=(day:string,n:number)=>addLocalDays(`${day}T00:00`,n).slice(0,10);
const startOfWeek=(day:string)=>plusDay(day,-((new Date(`${day}T12:00Z`).getUTCDay()+6)%7));
const freshEvent=(day:string):PlannerEvent=>({id:crypto.randomUUID(),title:'',startLocal:`${day}T18:00`,endLocal:'',location:'',notes:'',crewNeeded:0,people:[],coverageStartLocal:'',coverageEndLocal:'',archived:false});

export function EventPlanner({token,onSchedule,onAvailability}:{token:string;onSchedule:()=>void;onAvailability:()=>void}) {
  const [day,setDay]=useState(today);
  const [edit,setEdit]=useState<PlannerEvent|null>(null),[crew,setCrew]=useState<PlannerEvent|null>(null);
  const [manage,setManage]=useState(false),[guestName,setGuestName]=useState('');
  const [availability,setAvailability]=useState<PlannerAvailability|null>(null);
  const [incoming,setIncoming]=useState<PlannerData|null>(null),[needsCrew,setNeedsCrew]=useState(false),[showArchived,setShowArchived]=useState(false);
  const [search,setSearch]=useState('');
  const [mobileView,setMobileView]=useState<'events'|'crew'>('events');
  const file=useRef<HTMLInputElement>(null),editing=useRef(false);
  editing.current=Boolean(edit||crew||manage||incoming);
  const {plan,schedule,busy,error,setError,message,disabled,load,save}=useEventPlanner(token,editing.current);
  useEffect(()=>{
    const openToday=()=>{if(document.visibilityState==='visible'&&!editing.current)setDay(today());};
    document.addEventListener('visibilitychange',openToday);
    window.addEventListener('pageshow',openToday);
    return()=>{document.removeEventListener('visibilitychange',openToday);window.removeEventListener('pageshow',openToday);};
  },[]);
  async function reload(){setEdit(null);setCrew(null);setIncoming(null);setManage(false);setAvailability(null);await load();}
  const model=useMemo(()=>createPlannerModel(plan||emptyPlan(),schedule||{appointments:[],assignments:[]}),[plan,schedule]);
  const {people,personName,optionsFor}=model;
  const week=startOfWeek(day),days=Array.from({length:7},(_,i)=>plusDay(week,i));
  const {entries,dayEvents,appointments,unfilled,conflicts}=useMemo(()=>model.forDay(day,search,needsCrew,showArchived),[model,day,search,needsCrew,showArchived]);
  async function importFile(selected:File|undefined){
    if(!selected)return;
    try{if(selected.size>240000)throw new Error('Choose a saved plan under 240 KB.');const data=JSON.parse(await selected.text());setIncoming(validatePlan(data) as PlannerData);setError('');}catch(e){setError(e instanceof Error?e.message:'Could not read this plan.');}
    if(file.current)file.current.value='';
  }
  function exportPlan(){if(!plan)return;const url=URL.createObjectURL(new Blob([JSON.stringify({format:'smooth-event-plan',version:1,events:plan.events,guests:plan.guests,availability:plan.availability},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='Smooth-Studios-Event-Plan.json';a.click();URL.revokeObjectURL(url);}
  function newAvailability(){setAvailability({id:crypto.randomUUID(),personId:'',startLocal:`${day}T00:00`,endLocal:`${plusDay(day,1)}T00:00`,status:'available',note:''});}
  const feedback=<>{error&&<div className="schedule-error" role="alert"><p>{plannerTimeText(error)}</p><Button variant="outline" disabled={busy} onClick={()=>void reload()}>Reload planner</Button></div>}{message&&<p className="schedule-success" role="status">{message}</p>}</>;
  if(!plan||!schedule)return <section className="panel"><h2>Event Planner</h2>{error?feedback:<p>Loading events, studio bookings and availability…</p>}</section>;
  return <section className={`event-planner planner-view-${mobileView}`} aria-label="Event staffing planner">
    <header className="planner-heading"><div className="planner-actions"><Button disabled={disabled} onClick={()=>setEdit(freshEvent(day))}><Plus size={17}/>Add event</Button><Button variant="outline" onClick={()=>{setManage(true);setAvailability(null);}}>Crew availability</Button><Button variant="outline" aria-label="Refresh event planner" disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/></Button></div></header>
    {feedback}
    <div className="planner-calendar"><div className="planner-datebar"><div className="planner-actions"><Button variant="outline" aria-label="Previous week" onClick={()=>setDay(plusDay(day,-7))}><ChevronLeft size={18}/></Button><strong>{dayLabel(week,{month:'short',day:'numeric'})} - {dayLabel(plusDay(week,6),{month:'short',day:'numeric',year:'numeric'})}</strong><Button variant="outline" aria-label="Next week" onClick={()=>setDay(plusDay(day,7))}><ChevronRight size={18}/></Button></div><div className="planner-actions"><Button variant="ghost" onClick={()=>setDay(today())}>Today</Button><label className="sr-only" htmlFor="planner-day">Choose date</label><Input id="planner-day" type="date" value={day} onChange={e=>e.target.value&&setDay(e.target.value)}/></div></div>
    <div className="planner-days" role="group" aria-label="Choose a day">{days.map(d=>{const count=model.dayCounts.get(d)||0;return <button key={d} aria-label={`${dayLabel(d)} · ${count} ${count===1?'event':'events'}`} aria-pressed={d===day} onClick={()=>setDay(d)}><span>{dayLabel(d,{weekday:'short'})}</span><strong>{d.slice(8)}</strong><small><span className="planner-day-count">{count}</span><span className="planner-day-count-label"> {count===1?'event':'events'}</span></small></button>;})}</div></div>
    <div className="planner-summary"><div><strong>{dayEvents.length}</strong><span>Events</span></div><div><strong>{unfilled}</strong><span>Need crew</span></div><div className={conflicts?'has-conflict':''}><strong>{conflicts}</strong><span>Crew conflicts</span></div><div><strong>{appointments.length}</strong><span>Studio bookings</span></div></div>
    <div className="planner-mobile-switch" role="group" aria-label="Planner view"><button aria-pressed={mobileView==='events'} onClick={()=>setMobileView('events')}><CalendarDays size={16}/>Day’s events <span>{dayEvents.length}</span></button><button aria-pressed={mobileView==='crew'} onClick={()=>setMobileView('crew')}><Users size={16}/>Crew today</button></div>
    <div className="planner-columns"><div className="planner-day-content"><div className="planner-list-heading"><h3>{dayLabel(day)}</h3><Input aria-label="Search this day" placeholder="Search events or bookings" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <div className="planner-filter"><label><input type="checkbox" checked={needsCrew} onChange={e=>setNeedsCrew(e.target.checked)}/>Events needing crew</label><details className="planner-more-filters"><summary>More filters</summary><label><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/>Include archived events</label></details></div>
    <div className="planner-event-list">{!entries.length&&<article className="planner-empty"><CalendarDays size={28}/><h3>No matching work this day</h3><p>Add an event or choose another date.</p><Button variant="outline" onClick={()=>setEdit(freshEvent(day))}>Add event</Button></article>}
    {entries.map(entry=>{
      if('event' in entry){const e=entry.event,options=optionsFor(e),best=options.filter(p=>p.id!=='owner'&&['available','flexible'].includes(p.fit.status)),check=options.filter(p=>p.id!=='owner'&&p.fit.status==='check'&&p.fit.availableAtStart),warnings=e.people.flatMap(id=>{const f=model.fit(id,e);return f.status==='blocked'?[`${personName(id)}${hasPlannerOverride(e,id,f)?' (override)':''}: ${f.reasons.map(plannerTimeText).join('; ')}`]:[];});return <article className={`planner-event${e.archived?' archived':''}`} key={e.id}>
        <div className="planner-card-top"><span className="planner-kind">EVENT{e.archived?' · ARCHIVED':''}</span><span className={`planner-coverage ${e.crewNeeded&&e.people.length>=e.crewNeeded?'filled':''}`}>{!e.crewNeeded?'Set crew size':`${e.people.length}/${e.crewNeeded} planned`}</span></div>
        <strong className="planner-time">{windowLabel(e.startLocal,e.endLocal)}</strong><h3>{e.title}</h3>{e.location&&<p className="planner-location"><MapPin size={15}/>{e.location}</p>}
        {e.notes&&<details className="planner-notes"><summary>Event details</summary><p>{e.notes}</p></details>}
        <div className="planner-crew-block"><div className="planner-assigned">{e.people.length?e.people.map(id=><span key={id}><Users size={14}/>{personName(id)}</span>):<span className="empty"><Users size={15}/>Choose your crew</span>}</div>
        {(e.coverageStartLocal||e.coverageEndLocal)&&<p className="planner-small">Crew coverage: {windowLabel(e.coverageStartLocal||e.startLocal,e.coverageEndLocal||e.endLocal)}</p>}
        <p className="planner-options">{best.length?<>{best.some(p=>p.fit.status==='flexible')?'Available or flexible':'Available'}: <b>{best.map(p=>p.name).join(', ')}</b></>:check.length?<>Available at start: <b>{check.map(p=>p.name).join(', ')}</b> · confirm end</>:<>Check crew details for availability and conflicts.</>}</p></div>
        {warnings.length>0&&<p className="planner-warning"><AlertTriangle size={15}/>{warnings.join(' ')}</p>}
        <div className="planner-actions planner-card-actions"><Button disabled={disabled||e.archived} onClick={()=>setCrew({...e,people:[...e.people]})}><Users size={16}/>Plan crew</Button><Button variant="outline" disabled={disabled} onClick={()=>setEdit({...e})}><Pencil size={15}/>Edit</Button></div>
      </article>;}
      if('appointment' in entry){const a=entry.appointment,offers=schedule.assignments.filter(t=>t.appointmentId===a.id&&['pending','accepted'].includes(t.status));const ids=[...new Set([...a.acceptedEmployeeIds,...offers.map(t=>t.employeeId)])];return <article className="planner-booking" key={`booking-${a.id}`}><div className="planner-card-top"><span className="planner-kind">CALENDAR / STUDIO</span><span>{windowLabel(studioLocal(a.start),studioLocal(a.end))}</span></div><h3>{a.title}</h3>{a.customer&&<p>{a.customer}</p>}<p>{ids.length?ids.map(id=>`${personName(id)}${!a.acceptedEmployeeIds.includes(id)&&offers.find(t=>t.employeeId===id)?.status==='pending'?' (pending)':''}`).join(', '):'No confirmed crew shown'}</p><Button size="sm" variant="outline" onClick={onSchedule}>Open Team Schedule</Button></article>;}
      const t=entry.task;return <article className="planner-booking" key={`task-${t.id}`}><span className="planner-kind">STUDIO TASK · {t.status.toUpperCase()}</span><h3>{t.title}</h3><p>{windowLabel(studioLocal(t.start),studioLocal(t.end))} · {personName(t.employeeId)}</p><Button size="sm" variant="outline" onClick={onSchedule}>Open Team Schedule</Button></article>;
    })}</div></div>
    <aside className="planner-team panel"><h3>Crew today</h3><p className="planner-small">Open an event’s Plan crew to check its exact hours.</p>{people.map(p=>{
      const from=localInstant(`${day}T00:00`),to=localInstant(`${plusDay(day,1)}T00:00`);
      const blocks=schedule.blocks.filter(b=>b.userId===p.id).flatMap(b=>blockOccurrences(b,from,to));
      const preferences=(schedule.workPreferences||[]).filter(a=>a.userId===p.id).flatMap(a=>blockOccurrences(a,from,to));
      const notes=plan.availability.filter(a=>a.personId===p.id&&plannerOnDay(a,day));
      const jobs=dayEvents.filter(e=>e.people.includes(p.id));
      return <details key={p.id} className="planner-person"><summary><i style={{background:p.color}}/><span><b>{p.name}{p.guest?' · guest':''}</b><small>{jobs.length?`${jobs.length} event${jobs.length===1?'':'s'} planned`:notes.length||preferences.length?'Availability recorded':blocks.length?'Blocked hours recorded':p.id==='owner'?'Flexible schedule':'Availability unknown'}</small></span><ChevronRight size={15}/></summary><div>{notes.map(a=><p key={a.id}><b>{a.status}</b> {windowLabel(a.startLocal,a.endLocal)}{a.note&&` · ${plannerTimeText(a.note)}`}</p>)}{preferences.map((a,i)=><p key={`p${i}`}>Wants to work: {windowLabel(studioLocal(a.start),studioLocal(a.end))}</p>)}{blocks.map((a,i)=><p key={`b${i}`}>Blocked: {windowLabel(studioLocal(a.start),studioLocal(a.end))} · {plannerTimeText(a.reason)}</p>)}{jobs.map(e=><p key={e.id}>Planned: {e.title}</p>)}{!notes.length&&!preferences.length&&!blocks.length&&<p>{p.id==='owner'?'Flexible schedule. Add yourself through Plan crew on an event.':'No availability confirmed for this day.'}</p>}</div></details>;
    })}<Button variant="outline" onClick={onAvailability}>Dashboard availability</Button></aside></div>
    <footer className="planner-footer"><p>Saved crew choices are your private staffing plan. Use Team Schedule when you’re ready to send work offers.</p><details className="planner-tools"><summary>Import & export</summary><div className="planner-actions"><Button size="sm" variant="ghost" disabled={disabled} onClick={()=>file.current?.click()}><Upload size={15}/>Import plan</Button><Button size="sm" variant="ghost" onClick={exportPlan}><Download size={15}/>Export plan</Button><input ref={file} aria-label="Import saved event plan" className="sr-only" type="file" accept=".json,application/json" onChange={e=>void importFile(e.target.files?.[0])}/></div></details></footer>

<EventEditor value={edit} onChange={setEdit} save={event=>save({...plan,events:[...plan.events.filter(p=>p.id!==event.id),event]})} busy={busy} disabled={disabled} error={error} isExisting={plan.events.some(e=>e.id===edit?.id)}/>

<CrewEditor value={crew} onChange={setCrew} save={event=>save({...plan,events:plan.events.map(p=>p.id===event.id?event:p)},'Crew plan saved.')} busy={busy} disabled={disabled} error={error} optionsFor={optionsFor}/>

<PlannerDialog open={manage} onClose={()=>setManage(false)} busy={busy} title="Crew availability" description="Add guest crew and date-specific planning notes. Dashboard time blocks and existing work are checked too."><div className="planner-form"><form className="planner-guest-add" onSubmit={async e=>{e.preventDefault();if(await save({...plan,guests:[...plan.guests,{id:`guest-${crypto.randomUUID()}`,name:guestName}]}))setGuestName('');}}><label>Guest name<Input required maxLength={60} value={guestName} onChange={e=>setGuestName(e.target.value)}/></label><Button disabled={disabled}>Add guest</Button></form><Button variant="outline" disabled={disabled} onClick={newAvailability}>Add availability note</Button>{availability&&<form className="planner-availability-form" onSubmit={async e=>{e.preventDefault();if(await save({...plan,availability:[...plan.availability.filter(a=>a.id!==availability.id),availability]}))setAvailability(null);}}><label>Person<select required value={availability.personId} onChange={e=>setAvailability({...availability,personId:e.target.value})}><option value="">Choose a person</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Status<select value={availability.status} onChange={e=>setAvailability({...availability,status:e.target.value as PlannerAvailability['status']})}><option value="available">Available</option><option value="unavailable">Unavailable</option><option value="tentative">Needs confirmation</option></select></label><div className="schedule-form-pair"><PlannerDateTimeField label="From" required value={availability.startLocal} onChange={startLocal=>setAvailability({...availability,startLocal})}/><PlannerDateTimeField label="Until" required value={availability.endLocal} onChange={endLocal=>setAvailability({...availability,endLocal})}/></div><label>Note<Input maxLength={500} value={availability.note} onChange={e=>setAvailability({...availability,note:e.target.value})}/></label><div className="planner-actions"><Button disabled={disabled}>Save availability note</Button><Button type="button" variant="ghost" onClick={()=>setAvailability(null)}>Cancel note</Button></div></form>}<details><summary>Planning notes ({plan.availability.length})</summary><div className="planner-saved-notes">{plan.availability.map(a=><button key={a.id} onClick={()=>setAvailability({...a})}><b>{personName(a.personId)} · {a.status}</b><span>{dayLabel(a.startLocal.slice(0,10),{month:'short',day:'numeric'})} · {windowLabel(a.startLocal,a.endLocal)}</span><small>{plannerTimeText(a.note)}</small><Pencil size={14}/></button>)}</div></details><PlannerError error={error}/></div><DialogFooter><Button variant="outline" onClick={onAvailability}>Dashboard availability</Button><Button disabled={busy} onClick={()=>setManage(false)}>Done</Button></DialogFooter></PlannerDialog>

<PlannerDialog open={Boolean(incoming)} onClose={()=>setIncoming(null)} busy={busy} wide={false} title="Import event plan" description="Add the events and availability from your saved plan.">{incoming&&<><p>{incoming.events.length} events · {incoming.guests.length} guest crew · {incoming.availability.length} availability notes</p><p className="planner-small">Matching entries already in your plan are kept. Importing does not send work offers.</p><PlannerError error={error}/><DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setIncoming(null)}>Cancel</Button><Button disabled={disabled} onClick={async()=>{try{const next=mergePlan(plan,incoming);if(await save(next,'Events and availability imported.')){setDay(today());setIncoming(null);}}catch(caught){setError(caught instanceof Error?caught.message:'Could not import this plan.');}}}>Add to planner</Button></DialogFooter></>}</PlannerDialog>
  </section>;
}
