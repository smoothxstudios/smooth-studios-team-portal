// Home keeps the complete financial ledger, but older appointment descriptions,
// client details and Stripe matching records are fetched only when needed.
const columns = ['id', 'start', 'end', 'priceCents', 'paidOnlineCents', 'fullyPaid',
  'tipCents', 'paymentOverride', 'assignedEmployeeIds', 'employeePayouts', 'categoryId', 'category'];

export function homeDashboard(payload) {
  const cutoff = Date.parse(payload.generatedAt) - 45 * 86400_000;
  const recent = [], older = [];
  for (const rental of payload.rentals) {
    if (Date.parse(rental.end) < cutoff) older.push(columns.map(key => rental[key] ?? null));
    else recent.push(rental);
  }
  const { unmatchedStripePayments, ...home } = payload;
  return { ...home, rentals: recent, history: { deferred: true, rentalCount: payload.rentals.length,
    columns, rows: older, unmatchedCount: unmatchedStripePayments?.length ?? 0 } };
}

export function expandHomeLedger(payload) {
  if (!payload.history?.rows) return payload;
  const { rows, columns: fields, ...history } = payload.history;
  // Only financial fields belong in this projection; identity/role still come
  // from the authenticated, encrypted account payload.
  if (JSON.stringify(fields) !== JSON.stringify(columns)) throw new Error('Unsupported dashboard history.');
  const older = rows.map(row => ({ title: 'Past appointment', customer: '',
    ...Object.fromEntries(columns.flatMap((key, index) => row[index] === null && !['paidOnlineCents'].includes(key) ? [] : [[key, row[index]]])) }));
  return { ...payload, history, rentals: [...payload.rentals, ...older] };
}
