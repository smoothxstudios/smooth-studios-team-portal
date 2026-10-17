import { Check, Clock3 } from "lucide-react";
import { calendarDeliveryStatus } from "@/lib/calendar-delivery-status.mjs";
import type { CalendarDelivery } from "@/lib/team-api";

export function CalendarAssignmentStatus({ delivery }: { delivery?: CalendarDelivery }) {
  const state = calendarDeliveryStatus(delivery);
  if (!state) return null;
  return <p className="schedule-small calendar-assignment-status">{state.accepted ? <Check size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}{state.text}</p>;
}
