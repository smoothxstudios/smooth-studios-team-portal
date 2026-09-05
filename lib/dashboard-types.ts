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

export type Rental = {
  id: string;
  title: string;
  categoryId?: string;
  category?: string;
  customer: string;
  start: string;
  end: string;
  priceCents: number;
  paidOnlineCents: number | null;
  tipCents?: number;
  fullyPaid: boolean;
  paymentOverride?: boolean;
  assignedEmployeeIds: string[];
  employeePayouts: Record<string, EmployeePayout>;
};

export type DashboardPayload = {
  version: 1;
  source: "sample" | "google-calendar";
  generatedAt: string;
  calendarName: string;
  role: DashboardRole;
  user: Employee | { id: "owner"; name: string; accent: string };
  employees: Employee[];
  rentals: Rental[];
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
