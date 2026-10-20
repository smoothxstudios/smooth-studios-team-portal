"use client";
import { TEAM } from "@/lib/team-schedule.mjs";
export function PersonLabel({ id }: { id: string }) {
  const person = TEAM.find(person => person.id === id);
  return <span className="schedule-person"><i style={{ background: person?.color ?? "#737373" }} />{person?.name ?? id}</span>;
}
