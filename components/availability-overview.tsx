"use client";
import { useState } from "react";
import { TEAM, studioLocal, localInstant, addLocalDays, blockOccurrences, overlaps } from "@/lib/team-schedule.mjs";
import type { TeamSchedule } from "@/lib/team-api";
import { Button } from "@/components/ui/button";
const time = (s:string) => new Date(s).toLocaleTimeString("en-US", {timeZone:"America/New_York",hour:"numeric",minute:"2-digit"});
export function AvailabilityOverview({schedule,filter}:{schedule:TeamSchedule;filter:string}) {
  const [day,setDay]=useState(()=>studioLocal(Date.now()).slice(0,10));
  let start:string,end:string;
  try {start=localInstant(`${day}T00:00`);end=localInstant(addLocalDays(`${day}T00:00`,1));} catch {return null;}
  const span=(p:{start:string;end:string})=>`${time(Date.parse(p.start)<Date.parse(start)?start:p.start)}–${Date.parse(p.end)>=Date.parse(end)?"midnight":time(p.end)}`;
  return <section className="availability-overview"><h2>Availability at a glance</h2><div className="schedule-actions"><Button variant="outline" onClick={()=>setDay(addLocalDays(`${day}T00:00`,-1).slice(0,10))}>Previous day</Button><label>Day<input aria-label="Availability day" type="date" value={day} onChange={e=>{if(e.target.value)setDay(e.target.value);}} /></label><Button variant="outline" onClick={()=>setDay(addLocalDays(`${day}T00:00`,1).slice(0,10))}>Next day</Button><Button variant="ghost" onClick={()=>setDay(studioLocal(Date.now()).slice(0,10))}>Today</Button></div>
    {TEAM.filter(p=>(filter==="all"||filter===p.id)).map(p=>{
      const preferred=(schedule.workPreferences??[]).filter(x=>x.userId===p.id).flatMap(x=>blockOccurrences(x,start,end));
      const blocks=schedule.blocks.filter(x=>x.userId===p.id).flatMap(x=>blockOccurrences(x,start,end));
      const offers=schedule.assignments.filter(x=>x.employeeId===p.id&&["pending","accepted"].includes(x.status)&&overlaps(x,{start,end}));
      const rentals=schedule.appointments.filter(x=>x.acceptedEmployeeIds.includes(p.id)&&overlaps(x,{start,end})&&!offers.some(o=>o.appointmentId===x.id));
      return <div className="availability-overview-row" key={p.id}><strong style={{color:p.color}}>{p.name}</strong><div><span>Preferred</span><p>{p.id==="owner"?"Flexible":preferred.length?preferred.map(span).join(", "):"Not provided"}</p></div><div><span>Unavailable</span><p>{blocks.length?blocks.map(span).join(", "):"No blocks recorded"}</p></div><div><span>Scheduled / offered</span><p>{[...offers,...rentals].map(span).join(", ")||"None"}</p></div></div>;
    })}<p className="schedule-small">No blocks does not confirm availability. Preferred hours, existing work, and acceptance still matter.</p>
  </section>;
}
