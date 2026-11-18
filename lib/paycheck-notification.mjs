const etaFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric',
});

/** An ETA is a calendar date, so never shift it into the device's time zone. */
export function paycheckNotification(etaDate) {
  if (typeof etaDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(etaDate)) return null;
  const date = new Date(`${etaDate}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== etaDate) return null;
  return { title: 'Paycheck processed',
    body: `Your paycheck has been processed. ETA: ${etaFormat.format(date)}.`, target: 'payouts' };
}
