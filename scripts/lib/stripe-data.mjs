const STRIPE_API_BASE = "https://api.stripe.com/v1";

function cents(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

async function stripeListAll(resource, secretKey, parameters = {}) {
  const items = [];
  let startingAfter = null;

  do {
    const url = new URL(`${STRIPE_API_BASE}/${resource}`);
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    url.searchParams.set("limit", "100");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${secretKey}` },
    });
    if (!response.ok) {
      let message = `Stripe ${resource} request failed (${response.status})`;
      try {
        const body = await response.json();
        if (body?.error?.message) message += `: ${body.error.message}`;
      } catch {
        // Keep the status-only message if Stripe does not return JSON.
      }
      throw new Error(message);
    }

    const page = await response.json();
    const pageItems = Array.isArray(page.data) ? page.data : [];
    items.push(...pageItems);
    if (!page.has_more) break;
    const last = pageItems.at(-1);
    if (!last?.id) throw new Error(`Stripe ${resource} pagination did not return a final object ID`);
    startingAfter = last.id;
  } while (startingAfter);

  return items;
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, value.trim()]),
  );
}

export function normalizeStripeCharge(charge, paymentIntent, balanceTransaction) {
  if (!charge || charge.status !== "succeeded" || charge.paid !== true || charge.captured === false) return null;
  const capturedCents = cents(charge.amount_captured) || cents(charge.amount);
  if (capturedCents <= 0) return null;

  const refundedCents = Math.min(Math.max(cents(charge.amount_refunded), 0), capturedCents);
  const receivedCents = Math.max(capturedCents - refundedCents, 0);
  const feeCents = Math.max(cents(balanceTransaction?.fee), 0);
  const customerEmail = charge.billing_details?.email ?? charge.receipt_email ?? null;
  const customerName = charge.billing_details?.name ?? null;
  const metadata = { ...normalizeMetadata(paymentIntent?.metadata), ...normalizeMetadata(charge.metadata) };
  const searchText = [
    charge.id,
    charge.description,
    charge.calculated_statement_descriptor,
    charge.statement_descriptor,
    customerEmail,
    customerName,
    paymentIntent?.id,
    paymentIntent?.description,
    ...Object.entries(metadata).flat(),
  ].filter(Boolean).join(" ").toLowerCase();

  return {
    id: charge.id,
    paymentIntentId: typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null,
    created: new Date(cents(charge.created) * 1000).toISOString(),
    currency: String(charge.currency ?? "usd").toLowerCase(),
    capturedCents,
    refundedCents,
    receivedCents,
    feeCents,
    netCents: receivedCents - feeCents,
    customerEmail,
    customerName,
    description: charge.description ?? paymentIntent?.description ?? null,
    metadata,
    searchText,
    disputed: charge.disputed === true,
  };
}

function normalizeStripePayout(payout) {
  if (!payout || cents(payout.amount) <= 0) return null;
  return {
    id: payout.id,
    created: new Date(cents(payout.created) * 1000).toISOString(),
    arrivalDate: payout.arrival_date ? new Date(cents(payout.arrival_date) * 1000).toISOString() : null,
    amountCents: cents(payout.amount),
    currency: String(payout.currency ?? "usd").toLowerCase(),
    status: payout.status ?? "unknown",
  };
}

export async function fetchStripeSnapshot(secretKey, { importStart }) {
  if (!secretKey) throw new Error("A Stripe restricted key is required");
  const createdGte = Math.floor(new Date(importStart).getTime() / 1000);
  if (!Number.isFinite(createdGte)) throw new Error("Stripe import start must be a valid date");

  const [rawCharges, rawPaymentIntents, rawBalanceTransactions, rawPayouts] = await Promise.all([
    stripeListAll("charges", secretKey, { "created[gte]": createdGte }),
    stripeListAll("payment_intents", secretKey, { "created[gte]": createdGte }),
    stripeListAll("balance_transactions", secretKey, { "created[gte]": createdGte }),
    stripeListAll("payouts", secretKey, { "created[gte]": createdGte }),
  ]);

  const paymentIntents = new Map(rawPaymentIntents.map((item) => [item.id, item]));
  const balanceTransactions = new Map(rawBalanceTransactions.map((item) => [item.id, item]));
  const charges = rawCharges
    .map((charge) => {
      const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      const balanceTransactionId = typeof charge.balance_transaction === "string" ? charge.balance_transaction : charge.balance_transaction?.id;
      return normalizeStripeCharge(
        charge,
        paymentIntents.get(paymentIntentId),
        balanceTransactions.get(balanceTransactionId),
      );
    })
    .filter(Boolean)
    .filter((charge) => charge.currency === "usd");
  const payouts = rawPayouts
    .map(normalizeStripePayout)
    .filter(Boolean)
    .filter((payout) => payout.currency === "usd");

  return {
    generatedAt: new Date().toISOString(),
    charges,
    payouts,
  };
}

export function summarizeStripeSnapshot(snapshot, matchedChargeIds = new Set()) {
  const charges = snapshot?.charges ?? [];
  const payouts = snapshot?.payouts ?? [];
  const reconcilableCharges = charges.filter((charge) => charge.receivedCents > 0);
  const unmatched = reconcilableCharges.filter((charge) => !matchedChargeIds.has(charge.id));

  return {
    generatedAt: snapshot.generatedAt,
    paymentCount: charges.length,
    grossCents: charges.reduce((sum, charge) => sum + charge.capturedCents, 0),
    refundedCents: charges.reduce((sum, charge) => sum + charge.refundedCents, 0),
    feeCents: charges.reduce((sum, charge) => sum + charge.feeCents, 0),
    netCents: charges.reduce((sum, charge) => sum + charge.netCents, 0),
    bankPayoutCents: payouts.filter((payout) => payout.status === "paid").reduce((sum, payout) => sum + payout.amountCents, 0),
    pendingPayoutCents: payouts.filter((payout) => ["pending", "in_transit"].includes(payout.status)).reduce((sum, payout) => sum + payout.amountCents, 0),
    matchedPaymentCount: reconcilableCharges.length - unmatched.length,
    unmatchedPaymentCount: unmatched.length,
    unmatchedCents: unmatched.reduce((sum, charge) => sum + charge.receivedCents, 0),
    disputedPaymentCount: charges.filter((charge) => charge.disputed).length,
  };
}
