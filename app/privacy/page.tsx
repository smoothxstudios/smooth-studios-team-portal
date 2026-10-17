import type { Metadata } from "next";
import { dashboardBasePath } from "@/lib/site-path.mjs";

export const metadata: Metadata = { title: "Google Calendar privacy | Smooth Studios" };

export default function CalendarPrivacy() {
  return <main className="calendar-privacy">
    <a href={`${dashboardBasePath()}/`}>← Dashboard</a>
    <h1>Google Calendar connection privacy</h1>
    <p>Updated October 17, 2026</p>
    <p>Smooth Studios uses this optional connection to send team invitations for assigned Calendar events and update a connected team member’s RSVP when they accept or decline in the dashboard.</p>
    <h2>Information used</h2>
    <p>Google supplies your verified account email and Calendar access. The studio account also grants read access to its Calendar list to verify permission to edit the studio Calendar. The app uses event details, guest responses, and Google access and refresh tokens for these scheduling features.</p>
    <h2>Storage and access</h2>
    <p>OAuth client credentials and account tokens are encrypted in the backend database. Tokens stay on the server. Team members see their own scheduling information; Smooth can manage studio assignments. The existing Calendar import stores dashboard schedules in encrypted files.</p>
    <h2>How information is used</h2>
    <p>Google information is used for studio scheduling and the dashboard’s associated work and earnings records. It is not sold, used for advertising, or used to train AI models. The app’s use and transfer of Google API information follows the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including its Limited Use requirements.</p>
    <h2>Disconnecting</h2>
    <p>Use Settings → Preferences → Google Calendar → Disconnect to delete your stored connection and request revocation at Google. You can also remove access in your Google Account. Disconnecting keeps existing assignment, payment, and alert records. Contact Smooth through your usual studio contact for questions or other data requests.</p>
  </main>;
}
