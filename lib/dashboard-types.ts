export type DashboardRole = "owner" | "employee";

export type Employee = {
  id: string;
  name: string;
  email?: string;
  accent: string;
};

export type EmployeePayout = {
  amountCents: number;
  paid: boolean;
  paidAt?: string;
};

export type StripePaymentMatch = {
  receivedCents: number;
  grossCents: number;
  refundedCents: number;
  feeCents: number;
  netCents: number;
  paymentCount: number;
  matchConfidence: "manual" | "acuity-id" | "high";
  disputed: boolean;
};

export type StripeSummary = {
  generatedAt: string;
  paymentCount: number;
  grossCents: number;
  refundedCents: number;
  feeCents: number;
  netCents: number;
  bankPayoutCents: number;
  pendingPayoutCents: number;
  matchedPaymentCount: number;
  unmatchedPaymentCount: number;
  unmatchedCents: number;
  disputedPaymentCount: number;
};

export type UnmatchedStripePayment = {
  matchKey: string;
  reference: string;
  created: string;
  amountCents: number;
  refundedCents: number;
  customerName: string | null;
  customerEmail: string | null;
  description: string | null;
  disputed: boolean;
};

export type Rental = {
  id: string;
  stripeMatchKey?: string;
  title: string;
  categoryId?: string;
  category?: string;
  customer: string;
  start: string;
  end: string;
  priceCents: number;
  paidOnlineCents: number | null;
  calendarPaidOnlineCents?: number | null;
  tipCents?: number;
  fullyPaid: boolean;
  paymentSource?: "stripe" | "calendar" | "manual" | "none";
  stripePayment?: StripePaymentMatch;
  paymentOverride?: boolean;
  assignedEmployeeIds: string[];
  employeePayouts: Record<string, EmployeePayout>;
};

export type DashboardPayload = {
  version: 1;
  source: "sample" | "google-calendar";
  generatedAt: string;
  calendarName: string;
  integrations?: { calendar: boolean; stripe: boolean };
  role: DashboardRole;
  user: Employee | { id: "owner"; name: string; accent: string };
  employees: Employee[];
  rentals: Rental[];
  stripeSummary?: StripeSummary;
  unmatchedStripePayments?: UnmatchedStripePayment[];
  workflowAccess?: {
    provider: "github";
    repository: string;
    allowedLogin: string;
    accessToken: string;
  };
};

export type AccessProfile = {
  id: string;
  label: string;
  role: DashboardRole;
};

export type EncryptedEnvelope = {
  version: 1;
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};
