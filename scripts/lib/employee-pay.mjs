// Rates follow the appointment's local start date, including imported UTC times.
export function studioDate(value, timeZone = "America/New_York") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function validatePaidThrough(value, now = Date.now(), timeZone = "America/New_York") {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "") || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("--through must be a valid YYYY-MM-DD date");
  }
  if (value > studioDate(now, timeZone)) throw new Error("--through cannot be a future date");
  return value;
}

export function initializePayAdjustments(config, ledger) {
  ledger.employees ??= {};
  for (const employee of config.employees) {
    for (const change of employee.commissionHistory ?? []) {
      if (!change.adjustmentId) continue;
      const record = ledger.employees[employee.id] ??= {};
      record.rateAdjustments ??= {};
      // Freeze the old paid-through date once. Later syncs must never treat an
      // unpaid raise as paid just because it falls before the old cutoff.
      record.rateAdjustments[change.adjustmentId] ??= { originalPaidThrough: record.paidThrough ?? null, settledThrough: null };
    }
  }
  return ledger;
}

export function markEmployeeThrough(record, through) {
  if (!record.paidThrough || through > record.paidThrough) record.paidThrough = through;
  for (const adjustment of Object.values(record.rateAdjustments ?? {})) {
    if (!adjustment.settledThrough || through > adjustment.settledThrough) adjustment.settledThrough = through;
  }
}

export function calculateEmployeePayout({ employee, config, ledger, start, end, priceCents, categoryId, fullyPaid, now = Date.now() }) {
  const startDate = studioDate(start, config.timeZone);
  const endDate = studioDate(end, config.timeZone);
  const policy = employee.compensation;
  let rate = employee.commissionRate ?? config.commissionRate;
  const changes = [...(employee.commissionHistory ?? [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (const change of changes) if (startDate >= change.effectiveFrom) rate = change.rate;
  const configured = policy?.type !== "pending" && (policy?.type !== "hourly" || categoryId === "studio-rentals");
  const amountCents = !configured ? 0 : policy?.type === "hourly"
    ? Math.round((Date.parse(end) - Date.parse(start)) / 3600000 * policy.hourlyCents)
    : Math.round(priceCents * rate);
  const compensationLabel = !configured ? "Pay rate needed" : policy?.type === "hourly"
    ? `$${(policy.hourlyCents / 100).toFixed(2)}/hour`
    : `${Math.round(rate * 10000) / 100}% of appointment price`;
  const record = ledger.employees?.[employee.id] ?? {};
  const earned = configured && fullyPaid && Date.parse(end) <= now;
  const covered = earned && Boolean(record.paidThrough && endDate <= record.paidThrough);
  let paidAmountCents = covered ? amountCents : 0;
  if (covered && policy?.type !== "hourly") {
    for (const change of changes) {
      const adjustment = record.rateAdjustments?.[change.adjustmentId];
      if (startDate < change.effectiveFrom || !adjustment?.originalPaidThrough || endDate > adjustment.originalPaidThrough ||
          (adjustment.settledThrough && endDate <= adjustment.settledThrough)) continue;
      paidAmountCents = Math.min(paidAmountCents, Math.round(priceCents * change.previousRate));
    }
  }
  const outstandingCents = Math.max(amountCents - paidAmountCents, 0);
  return { amountCents, paidAmountCents, outstandingCents, compensationLabel, compensationConfigured: configured,
    paid: covered && outstandingCents === 0,
    ...(paidAmountCents > 0 ? { paidAt: record.paidThrough } : {}) };
}
