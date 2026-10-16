import type { TeamAppointment, TeamAssignment } from "@/lib/team-api";

export type WorkEntry = {
  id: string; kind: "work"; start: string; end: string; title: string; customer: string;
  appointment: TeamAppointment | null; assignments: TeamAssignment[];
  calendarIds: string[]; confirmedIds: string[]; pendingIds: string[]; employeeIds: string[];
  confirmations: { employeeId: string; appStatus: "accepted" | "pending" | null; calendarAccepted: boolean }[];
  status: "unassigned" | "pending" | "confirmed";
};
export type AvailabilityEntry = {
  id: string; kind: "block" | "preference"; start: string; end: string; title: string;
  userId: string; note?: string; allDay?: boolean; employeeIds: string[];
};
export type ScheduleEntry = WorkEntry | AvailabilityEntry;
export type ScheduleView = "day" | "week" | "month" | "list";
