import { categorizeAppointment } from "@/lib/appointment-categories.mjs";
import type {
AccessProfile,
EmployeePayout,
Rental,
UnmatchedStripePayment
} from "@/lib/dashboard-types";
import { customerFullyPaid } from "@/lib/owner-finances.mjs";
import { TEAM, studioLocal } from "@/lib/team-schedule.mjs";

export const FALLBACK_PROFILES: AccessProfile[] = TEAM.map(person => ({ id: person.id, label: person.name, role: person.id === "owner" ? "owner" : "employee" }));

export const TEAM_ACCENTS: Record<string, string> = Object.fromEntries(TEAM.map(person => [person.id, person.color]));

export const STUDIO_TIME_ZONE = "America/New_York";

export const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const MONEY_EXACT = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export type ViewKey = "planner" | "alerts" | "overview" | "rentals" | "team" | "payouts" | "guide" | "checklists" | "scheduling" | "availability" | "creative" | "settings";

export type RentalState = "upcoming" | "earned" | "paid" | "awaiting";

export type CustomerPaymentState = "paid" | "deposit" | "review" | "pending";

export type AppointmentStatus = RentalState | "customer-paid" | "upcoming-paid" | "deposit" | "review";

export type PaymentFilter = "all" | CustomerPaymentState;

export function dollars(cents: number, exact = false) {
  return (exact ? MONEY_EXACT : MONEY).format(cents / 100);
}

export function teamAccent(id: string, fallback = "#242428") {
  return TEAM_ACCENTS[id.toLowerCase()] ?? fallback;
}

export function formatDate(value: string, compact = false) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIME_ZONE,
    month: compact ? "short" : "long",
    day: "numeric",
    year: compact ? undefined : "numeric",
  }).format(new Date(value));
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function durationLabel(rental: Rental) {
  const minutes = Math.round((new Date(rental.end).getTime() - new Date(rental.start).getTime()) / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hrs`;
}

export function customerPaymentState(rental: Rental): CustomerPaymentState {
  if (customerFullyPaid(rental)) return "paid";
  if (rental.stripePayment?.disputed) return "review";
  if (new Date(rental.end).getTime() <= Date.now()) return "review";
  if ((rental.paidOnlineCents ?? 0) > 0) return "deposit";
  return "pending";
}

export function paidEarnings(payout?: EmployeePayout) {
  return payout?.paidAmountCents ?? (payout?.paid ? payout.amountCents : 0);
}

export function unpaidEarnings(payout?: EmployeePayout) {
  return payout?.outstandingCents ?? Math.max((payout?.amountCents ?? 0) - paidEarnings(payout), 0);
}

export function rentalState(rental: Rental, employeeId?: string): RentalState {
  const ended = new Date(rental.end).getTime() <= Date.now();
  if (!ended) return "upcoming";
  if (!customerFullyPaid(rental)) return "awaiting";
  if (employeeId && rental.employeePayouts[employeeId]?.paid) return "paid";
  return "earned";
}

export function eligibleForPayout(rental: Rental, paidThrough: string, employeeScope: string) {
  const endDate = new Intl.DateTimeFormat("en-CA", { timeZone: STUDIO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(rental.end));
  if (endDate > paidThrough || new Date(rental.end).getTime() > Date.now() || !customerFullyPaid(rental)) return false;
  if (employeeScope === "all") return Object.values(rental.employeePayouts).some((payout) => unpaidEarnings(payout) > 0);
  const payout = rental.employeePayouts[employeeScope];
  return Boolean(payout && unpaidEarnings(payout) > 0);
}

export function appointmentStatus(rental: Rental, employeeId?: string): AppointmentStatus {
  const paymentState = customerPaymentState(rental);
  if (paymentState === "deposit") return "deposit";
  if (paymentState === "pending") return "awaiting";
  if (paymentState === "review") return "review";
  if (new Date(rental.end).getTime() > Date.now()) return "upcoming-paid";
  if (!employeeId) return "customer-paid";
  return rentalState(rental, employeeId);
}

export function appointmentCategory(rental: Rental) {
  if (rental.categoryId && rental.category) return { id: rental.categoryId, label: rental.category };
  const category = categorizeAppointment(rental.title);
  return { id: category.id, label: category.label };
}

export function normalizedMatchText(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function stripeAppointmentScore(payment: UnmatchedStripePayment, rental: Rental) {
  const paymentName = normalizedMatchText(payment.customerName);
  const customer = normalizedMatchText(rental.customer);
  let score = 0;
  if (paymentName && customer && paymentName === customer) score += 100;
  else if (paymentName && customer && (paymentName.includes(customer) || customer.includes(paymentName))) score += 45;
  if (payment.amountCents === rental.priceCents) score += 50;
  else if (payment.amountCents < rental.priceCents) score += 22;
  const distance = Math.abs(new Date(rental.start).getTime() - new Date(payment.created).getTime()) / 86_400_000;
  if (distance <= 7) score += 35;
  else if (distance <= 45) score += 20;
  else if (distance <= 180) score += 8;
  return score;
}

export function formatCheckInTime(value: string | number, now = Date.now()) {
  const day = studioLocal(value).slice(0, 10);
  const today = studioLocal(now).slice(0, 10);
  const previousDay = new Date(`${today}T12:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const label = day === today ? "Today" : day === previousDay.toISOString().slice(0, 10) ? "Yesterday" : null;
  const time = new Intl.DateTimeFormat("en-US", { timeZone: STUDIO_TIME_ZONE, hour: "numeric", minute: "2-digit" });
  return label ? `${label} at ${time.format(new Date(value))}` : new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}
