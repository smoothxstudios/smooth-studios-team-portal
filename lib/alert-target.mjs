import { base64url, unbase64url } from "./team-auth.mjs";

const rentalPrefix = "rental_";
const legacyTargetId = /^[a-zA-Z0-9_-]{1,80}$/;
const rentalTargetId = /^rental_[a-zA-Z0-9_-]{2,1200}$/;

// Calendar IDs are opaque and can include punctuation. Keep them inside an
// explicitly typed destination; this value is only used for a schedule lookup.
export function rentalAlertTargetId(appointmentId) {
  if (typeof appointmentId !== "string" || !appointmentId || appointmentId.length > 300) return null;
  const bytes = new TextEncoder().encode(appointmentId);
  if (new TextDecoder().decode(bytes) !== appointmentId) return null;
  return `${rentalPrefix}${base64url(bytes)}`;
}

export function rentalAppointmentId(targetId) {
  if (typeof targetId !== "string" || !rentalTargetId.test(targetId)) return null;
  try {
    const id = new TextDecoder("utf-8", { fatal: true }).decode(unbase64url(targetId.slice(rentalPrefix.length)));
    return rentalAlertTargetId(id) === targetId ? id : null;
  } catch { return null; }
}

export function safeAlertTargetId(kind, target, targetId) {
  if (typeof targetId === "string" && targetId.startsWith(rentalPrefix)) {
    return kind === "notice" && target === "scheduling" && rentalAppointmentId(targetId) ? targetId : null;
  }
  return typeof targetId === "string" && legacyTargetId.test(targetId) ? targetId : null;
}
