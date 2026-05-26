import { createHash } from 'crypto';
import { db, DB_AVAILABLE } from '@/lib/db/client';
import type {
  LedgerEntryRow,
  PaymentQuoteRow,
  PaymentTransactionRow,
  SupplierBookingRow,
} from '@/lib/db/client';

function cents(value: number | undefined): number {
  return Math.max(0, Math.round(Number(value) || 0));
}

function currency(value: string | undefined): string {
  return (value || 'USD').trim().toUpperCase();
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function buildCartHash(input: {
  sessionId: string;
  bookingReference: string;
  offerIds: string[];
  fareAmountCents: number;
  fareCurrency: string;
  feeAmountCents: number;
  taxCents: number;
  chargeAmountCents: number;
  chargeCurrency: string;
}): string {
  return hashJson({
    sessionId: input.sessionId,
    bookingReference: input.bookingReference,
    offerIds: input.offerIds.slice().sort(),
    fareAmountCents: cents(input.fareAmountCents),
    fareCurrency: currency(input.fareCurrency),
    feeAmountCents: cents(input.feeAmountCents),
    taxCents: cents(input.taxCents),
    chargeAmountCents: cents(input.chargeAmountCents),
    chargeCurrency: currency(input.chargeCurrency),
  });
}

export async function createPaymentQuoteRecord(input: {
  sessionId?: string;
  bookingReference: string;
  market: 'CA' | 'US' | 'IN' | 'OTHER';
  supplier: 'duffel' | 'liteapi' | 'mixed';
  flightOfferId?: string;
  hotelRateId?: string;
  fareAmountCents: number;
  fareCurrency: string;
  feeAmountCents: number;
  feeCurrency: string;
  taxCents: number;
  taxLabel?: string;
  chargeAmountCents: number;
  chargeCurrency: string;
  metadata?: Record<string, unknown>;
}): Promise<PaymentQuoteRow | null> {
  if (!DB_AVAILABLE) return null;

  const sessionId = input.sessionId || `checkout:${input.bookingReference}`;
  const offerIds = [input.flightOfferId, input.hotelRateId].filter(Boolean) as string[];
  const cartHash = buildCartHash({
    sessionId,
    bookingReference: input.bookingReference,
    offerIds,
    fareAmountCents: input.fareAmountCents,
    fareCurrency: input.fareCurrency,
    feeAmountCents: input.feeAmountCents,
    taxCents: input.taxCents,
    chargeAmountCents: input.chargeAmountCents,
    chargeCurrency: input.chargeCurrency,
  });

  const existing = await db.paymentQuotes.getOpenBySessionCartHash(sessionId, cartHash);
  if (existing) return existing;

  const supplier = input.supplier === 'mixed' ? 'duffel,liteapi' : input.supplier;
  const quote = await db.paymentQuotes.create({
    session_id:           sessionId,
    market:               input.market,
    strategy:             input.supplier === 'liteapi' ? 'supplier_direct' : 'stripe_balance',
    merchant_of_record:   'FlexeTravels and Tours Inc.',
    supplier,
    fare_amount_cents:    cents(input.fareAmountCents),
    fare_currency:        currency(input.fareCurrency),
    fee_amount_cents:     cents(input.feeAmountCents),
    fee_currency:         currency(input.feeCurrency),
    charge_amount_cents:  cents(input.chargeAmountCents),
    charge_currency:      currency(input.chargeCurrency),
    offer_ids:            offerIds,
    cart_hash:            cartHash,
    caveats:              [
      'Live supplier price is re-verified before payment setup.',
      'Supplier ticket rules and cancellation rules govern the final booking.',
      ...(input.taxCents > 0 ? [`Service fee tax captured as ${input.taxLabel ?? 'tax'}.`] : []),
    ],
    expires_at:           new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    status:               'open',
    metadata:             {
      booking_reference: input.bookingReference,
      service_fee_tax_cents: cents(input.taxCents),
      service_fee_tax_label: input.taxLabel ?? null,
      flight_offer_id: input.flightOfferId ?? null,
      hotel_rate_id: input.hotelRateId ?? null,
      ...(input.metadata ?? {}),
    },
  });

  return quote;
}

export async function getOrCreatePaymentTransaction(input: {
  quoteId?: string;
  providerPaymentId: string;
  status: PaymentTransactionRow['status'];
  amountCents: number;
  currency: string;
  expectedAmountCents: number;
  expectedCurrency: string;
  rawPayload?: Record<string, unknown>;
}): Promise<PaymentTransactionRow | null> {
  if (!DB_AVAILABLE || !input.quoteId) return null;

  const existing = await db.paymentTransactions.getByProviderPaymentId('stripe', input.providerPaymentId);
  if (existing) return existing;

  return db.paymentTransactions.create({
    quote_id:              input.quoteId,
    provider:              'stripe',
    provider_payment_id:   input.providerPaymentId,
    idempotency_key:       `stripe:${input.providerPaymentId}`,
    status:                input.status,
    amount_cents:          cents(input.amountCents),
    currency:              currency(input.currency),
    expected_amount_cents: cents(input.expectedAmountCents),
    expected_currency:     currency(input.expectedCurrency),
    raw_payload:           input.rawPayload ?? {},
  });
}

export async function hasConfirmedSupplierBooking(paymentTransactionId?: string): Promise<boolean> {
  if (!DB_AVAILABLE || !paymentTransactionId) return false;
  const rows = await db.supplierBookings.listByPaymentTransactionId(paymentTransactionId);
  return rows.some(row => row.status === 'confirmed' || row.status === 'requires_action');
}

export async function recordSupplierBookingAndLedger(input: {
  quoteId?: string;
  paymentTransactionId?: string;
  supplier: SupplierBookingRow['supplier'];
  productType: SupplierBookingRow['product_type'];
  supplierOfferId?: string;
  supplierBookingId?: string;
  supplierReference?: string;
  status: SupplierBookingRow['status'];
  amountCents: number;
  currency: string;
  chargeAmountCents?: number;
  serviceFeeCents?: number;
  serviceFeeTaxCents?: number;
  failureReason?: string;
  rawRequest?: Record<string, unknown>;
  rawResponse?: Record<string, unknown>;
}): Promise<void> {
  if (!DB_AVAILABLE || !input.quoteId) return;

  const supplierBooking = await db.supplierBookings.create({
    quote_id:                 input.quoteId,
    payment_transaction_id:   input.paymentTransactionId ?? null,
    supplier:                 input.supplier,
    product_type:             input.productType,
    supplier_offer_id:        input.supplierOfferId ?? null,
    supplier_booking_id:      input.supplierBookingId ?? null,
    supplier_reference:       input.supplierReference ?? null,
    status:                   input.status,
    amount_cents:             cents(input.amountCents),
    currency:                 currency(input.currency),
    failure_reason:           input.failureReason ?? null,
    raw_request:              input.rawRequest ?? {},
    raw_response:             input.rawResponse ?? {},
  });

  if (!supplierBooking || input.status !== 'confirmed') return;

  const entries: Array<Partial<LedgerEntryRow>> = [];
  const chargeAmountCents = cents(input.chargeAmountCents);
  const fareAmountCents = cents(input.amountCents);
  const feeAmountCents = cents(input.serviceFeeCents);
  const taxCents = cents(input.serviceFeeTaxCents);
  const entryCurrency = currency(input.currency);

  if (chargeAmountCents > 0) {
    entries.push({
      quote_id: input.quoteId,
      payment_transaction_id: input.paymentTransactionId ?? null,
      supplier_booking_id: supplierBooking.id,
      account: 'stripe_cash',
      direction: 'debit',
      amount_cents: chargeAmountCents,
      currency: entryCurrency,
      memo: 'Customer card charge captured by Stripe',
    });
  }

  if (fareAmountCents > 0) {
    entries.push({
      quote_id: input.quoteId,
      payment_transaction_id: input.paymentTransactionId ?? null,
      supplier_booking_id: supplierBooking.id,
      account: 'supplier_payable',
      direction: 'credit',
      amount_cents: fareAmountCents,
      currency: entryCurrency,
      memo: `${input.supplier} supplier fare payable`,
    });
  }

  if (feeAmountCents > 0) {
    entries.push({
      quote_id: input.quoteId,
      payment_transaction_id: input.paymentTransactionId ?? null,
      supplier_booking_id: supplierBooking.id,
      account: 'service_fee_revenue',
      direction: 'credit',
      amount_cents: feeAmountCents,
      currency: entryCurrency,
      memo: taxCents > 0
        ? `FlexeTravels service fee revenue; tax tracked in payment quote metadata (${taxCents} cents)`
        : 'FlexeTravels service fee revenue',
    });
  }

  await db.ledgerEntries.createMany(entries);
  await db.paymentQuotes.consumeOpen(input.quoteId).catch(() => null);
}
