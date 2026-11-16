export function studioTaskPay(input, start, end) {
  if (!['hourly', 'flat'].includes(input?.type) || !Number.isSafeInteger(input.rateCents) || input.rateCents <= 0 || input.rateCents > 10_000_000) throw new Error('Choose hourly or flat pay and enter a positive amount.');
  const hours = (Date.parse(end) - Date.parse(start)) / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error('A studio task shift must last between one minute and 24 hours.');
  const amountCents = input.type === 'hourly' ? Math.round(input.rateCents * hours) : input.rateCents;
  if (amountCents < 1 || amountCents > 10_000_000) throw new Error('The total shift pay must be between $0.01 and $100,000.');
  return { type: input.type, rateCents: input.rateCents, amountCents };
}
