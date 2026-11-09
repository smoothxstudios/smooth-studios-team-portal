import { dollars, formatDate, formatTime } from "@/lib/dashboard-presentation";
import { addLocalDays, studioLocal, TEAM } from "@/lib/team-schedule.mjs";

const names = new Map(TEAM.map(person => [person.id, person.name]));
export const personName = (id: string) => names.get(id) ?? id;
export const time = formatTime;
export const date = (value: string) => formatDate(value, true);
export const money = (cents: number) => dollars(cents, true);
export const future = (value: string) => Date.parse(value) > Date.now();
export const initialPeriod = () => {
  const day = addLocalDays(studioLocal(Date.now()), 1).slice(0, 10);
  return { startLocal: `${day}T09:00`, endLocal: `${day}T10:00` };
};
export type ScheduleMutation = (path: string, data: object, method?: string) => Promise<boolean>;
export type ScheduleConfirmationChange = { path: string; method: string; data: object; description: string };
