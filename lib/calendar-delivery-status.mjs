/** Keep an app response distinct from a verified Google RSVP. */
export function calendarDeliveryStatus(delivery) {
  if (!delivery) return null;
  if (delivery.status === "synced") {
    if (delivery.code === "person_removed") return { accepted: false, text: "Person removed from Google Calendar" };
    if (delivery.code === "invitation_removed") return { accepted: false, text: "App-created Google invitation removed" };
    if (delivery.code === "no_calendar_invitation") return { accepted: false, text: "No Google invitation to update" };
    if (delivery.code === "existing_calendar_guest_preserved") return { accepted: false, text: "Separate Google invitation kept · review it in Google Calendar" };
    if (delivery.googleStatus === "accepted") return { accepted: true, text: "Google Calendar accepted" };
    if (delivery.googleStatus === "declined") return { accepted: false, text: "Google Calendar declined" };
    if (delivery.googleStatus === "removed") return { accepted: false, text: "App-created Google invitation removed" };
    return { accepted: false, text: "Google invitation sent" };
  }
  if (delivery.status === "needs_connection") return { accepted: false, text: "Google connection needed · Settings → Google Calendar" };
  if (delivery.status === "needs_review") return { accepted: false, text: delivery.code === "guest_notifications_review" ? "Event has other guests · add or remove this person in Google Calendar" : delivery.code === "invitation_missing" ? "Google invitation no longer listed · ask Smooth to review" : "Google invitation needs Smooth’s review" };
  if (delivery.status === "stale") return { accepted: false, text: delivery.code === "event_started"
    ? "Google updates stop after the rental starts · app response kept"
    : "Calendar event changed · review this assignment" };
  if (delivery.status === "retrying") return { accepted: false, text: "Google Calendar update will retry" };
  return { accepted: false, text: "Updating Google Calendar…" };
}
