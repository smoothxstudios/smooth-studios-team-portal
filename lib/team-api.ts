import { TEAM_API_URL } from "@/lib/team-schedule.mjs";
import { unbase64url } from "@/lib/team-auth.mjs";

export type TimeBlock = { id: string; userId: string; reason: string; startLocal: string; endLocal: string; repeatUntil: string | null; createdAt: string };
export type TeamAppointment = { id: string; title: string; customer: string; start: string; end: string; priceCents: number; acceptedEmployeeIds: string[] };
export type TeamAssignment = { id: string; employeeId: string; appointmentId: string | null; title: string; instructions: string; start: string; end: string; status: "pending" | "accepted" | "declined" | "cancelled"; createdAt: string; updatedAt: string; note?: string; conflictOverride?: { approvedBy: "owner"; approvedAt: string; start: string; end: string } };
export type TeamSchedule = { revision: number; syncedAt: string | null; appointments: TeamAppointment[]; blocks: TimeBlock[]; assignments: TeamAssignment[]; devices: Record<string, number>; pushPublicKey: string | null };

export async function teamRequest<T>(token: string, path: string, data?: unknown, method?: string): Promise<T> {
  const response = await fetch(`${TEAM_API_URL}${path}`, {
    method: method ?? (data === undefined ? "GET" : "POST"), cache: "no-store", redirect: "error",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(20_000),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error("Team scheduling is not available yet. Please try again later."); }
  if (!response.ok) throw new Error(result.error || `The scheduling request failed (${response.status}).`);
  return result as T;
}

export async function teamWorker() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    throw new Error("Push is unavailable here. On iPhone, add this dashboard to your Home Screen, then open it from that icon.");
  }
  const scope = new URL("./", window.location.href);
  const registration = await navigator.serviceWorker.register(new URL("team-sw.js", scope), { scope: scope.pathname });
  if (!registration.active) await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => window.setTimeout(() => reject(new Error("Notification setup took too long. Please try again.")), 10_000)),
  ]);
  return registration;
}

export async function enableTeamPush(token: string, key: string, permission: NotificationPermission) {
  if (permission !== "granted") throw new Error("Notifications were not allowed. You can still view and accept assignments in the portal.");
  const registration = await teamWorker();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: unbase64url(key),
  });
  await teamRequest(token, "/push/device", { endpoint: subscription.endpoint });
}

export async function disableTeamPush(token: string) {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(new URL("./", window.location.href).href);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  // Remove the browser subscription even when the server cannot be reached.
  // A later push receives 410 and removes the stale server registration.
  try { await teamRequest(token, "/push/device", { endpoint: subscription.endpoint }, "DELETE"); }
  finally { await subscription.unsubscribe(); }
}
