"use client";
import { rentalSuggestions } from "@/lib/rental-suggestions.mjs";
import type { TeamSchedule } from "@/lib/team-api";
import { Button } from "@/components/ui/button";
export function RentalSuggestions({period,schedule,onChoose,busy=false}: {period: {start:string;end:string;id?:string;appointmentId?:string};schedule:TeamSchedule;onChoose?:(id:string)=>void;busy?:boolean}) {
  const suggestions = rentalSuggestions(period,schedule);
  return <section className="rental-suggestions"><h3>Suggested people</h3><p className="schedule-small">Available unless blocked or already booked. Preferred hours come first; offers still need acceptance.</p>
    {!suggestions.length && <p>No conflict-free suggestions for this time. Review availability before assigning.</p>}
    {suggestions.slice(0,3).map(p=><div className="suggestion-row" key={p.id}><span><strong>{p.name}</strong><small>{p.reason}</small></span>{onChoose && <Button type="button" variant="outline" disabled={busy} onClick={()=>onChoose(p.id)}>Choose {p.name}</Button>}</div>)}
  </section>;
}
