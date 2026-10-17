export type DashboardRole = "owner" | "employee";

export type Employee = {
  id: string;
  name: string;
  email?: string;
  accent: string;
  onboarding?: boolean;
  accessReady?: boolean;
};

export type EmployeePayout = {
  amountCents: number;
  paidAmountCents?: number;
  recordedPaidAmountCents?: number;
  cashPaidCents?: number;
  advanceAppliedCents?: number;
  outstandingCents?: number;
  compensationLabel?: string;
  compensationConfigured?: boolean;
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

export type StudioGuideline = {
  id: string;
  title: string;
  category: string;
  body: string;
  tags: string[];
};

export type StudioRulebook = {
  version: 1;
  updatedAt: string | null;
  entries: StudioGuideline[];
};

export type Rental = {
  calendarInvitations?: { employeeId: string; status: "accepted" | "tentative" | "needsAction" | "declined" }[];
  rentalDetails?: string;
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

export type AdvanceBalance = { employeeId: string; totalCents: number; appliedCents: number; remainingCents: number };
export type PayrollState = {
  version: 1; syncedAt: string | null; balances: AdvanceBalance[];
  allocations: { employeeId: string; kind: "rental" | "creative"; sourceId: string; amountCents: number; cashFloorCents: number }[];
  reviewCount: number;
};

export type DashboardPayload = {
  payroll?: PayrollState;
  version: 1;
  source: "sample" | "google-calendar";
  generatedAt: string;
  calendarName: string;
  integrations?: { calendar: boolean; stripe: boolean };
  calendarAssignmentSync?: {
    status: "synced" | "needs_access" | "retrying";
    updated: number;
    failed: number;
    checkedAt: string;
    serviceAccountEmail?: string;
  };
  role: DashboardRole;
  user: Employee | { id: "owner"; name: string; accent: string };
  employees: Employee[];
  rentals: Rental[];
  stripeSummary?: StripeSummary;
  unmatchedStripePayments?: UnmatchedStripePayment[];
  rulebook?: StudioRulebook;
  teamAccess?: Record<string, { password: string }>;
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
