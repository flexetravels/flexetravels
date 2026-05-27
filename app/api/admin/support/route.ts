import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  '';

type Row = Record<string, unknown>;

interface SupportLookupResult {
  query: string;
  sessions: Row[];
  searches: Row[];
  passengers: Row[];
  paymentQuotes: Row[];
  paymentTransactions: Row[];
  supplierBookings: Row[];
  ledgerEntries: Row[];
  legacyPayments: Row[];
  legacyBookings: Row[];
  timeline: Array<{
    at: string;
    type: string;
    label: string;
    status?: string;
    amount?: string;
    sourceTable: string;
    id?: string;
  }>;
}

function cleanQuery(raw: string | null): string {
  return (raw ?? '').trim().slice(0, 160);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function inFilter(values: string[]): string | null {
  const clean = Array.from(new Set(values.filter(Boolean)));
  if (!clean.length) return null;
  return `in.(${clean.map(v => `"${v.replaceAll('"', '')}"`).join(',')})`;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (!value || typeof value !== 'object') return value;

  const out: Row = {};
  for (const [key, nested] of Object.entries(value as Row)) {
    const k = key.toLowerCase();
    if (
      k.includes('passport') ||
      k.includes('document') ||
      k.includes('secret') ||
      k.includes('token') ||
      k.includes('authorization') ||
      k.includes('apikey') ||
      k.includes('api_key') ||
      k.includes('card')
    ) {
      out[key] = '[redacted]';
    } else {
      out[key] = maskSensitive(nested);
    }
  }
  return out;
}

function sanitizeRows(rows: Row[]): Row[] {
  return rows.map(row => maskSensitive(row) as Row);
}

async function fetchRows(
  table: string,
  params: Record<string, string | number | undefined>,
): Promise<Row[]> {
  if (!SUPABASE_URL || !SERVICE_KEY) return [];

  const qs = new URLSearchParams();
  qs.set('select', '*');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value));
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error(`[support-lookup] ${table} failed ${res.status}:`, detail.slice(0, 200));
    return [];
  }

  const data = await res.json();
  return Array.isArray(data) ? data as Row[] : [];
}

function collectIds(rows: Row[], key: string): string[] {
  return rows.map(row => asString(row[key])).filter(Boolean) as string[];
}

function amount(row: Row): string | undefined {
  const cents =
    asNumber(row.amount_cents) ??
    asNumber(row.charge_amount_cents) ??
    asNumber(row.fare_amount_cents);
  const currency =
    asString(row.currency) ??
    asString(row.charge_currency) ??
    asString(row.fare_currency);
  if (cents === null || !currency) return undefined;
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

function timelineItem(row: Row, table: string, type: string, label: string) {
  return {
    at: asString(row.created_at) ?? asString(row.first_seen_at) ?? asString(row.paid_at) ?? '',
    type,
    label,
    status: asString(row.status) ?? undefined,
    amount: amount(row),
    sourceTable: table,
    id: asString(row.id) ?? asString(row.session_id) ?? undefined,
  };
}

function buildTimeline(result: Omit<SupportLookupResult, 'timeline'>): SupportLookupResult['timeline'] {
  const items = [
    ...result.sessions.map(row => timelineItem(row, 'user_sessions', 'session', `Session ${asString(row.session_id) ?? ''}`)),
    ...result.searches.map(row => timelineItem(row, 'search_logs', 'search', `${asString(row.search_type) ?? 'search'} ${asString(row.origin) ?? ''} -> ${asString(row.destination) ?? ''}`)),
    ...result.paymentQuotes.map(row => timelineItem(row, 'payment_quotes', 'quote', `${asString(row.strategy) ?? 'quote'} quote`)),
    ...result.paymentTransactions.map(row => timelineItem(row, 'payment_transactions', 'payment', `${asString(row.provider) ?? 'payment'} ${asString(row.provider_payment_id) ?? ''}`)),
    ...result.supplierBookings.map(row => timelineItem(row, 'supplier_bookings', 'supplier', `${asString(row.product_type) ?? 'supplier'} via ${asString(row.supplier) ?? ''}`)),
    ...result.ledgerEntries.map(row => timelineItem(row, 'ledger_entries', 'ledger', `${asString(row.account) ?? 'ledger'} ${asString(row.direction) ?? ''}`)),
    ...result.legacyPayments.map(row => timelineItem(row, 'payments', 'payment', `Legacy payment ${asString(row.stripe_intent_id) ?? ''}`)),
    ...result.legacyBookings.map(row => timelineItem(row, 'bookings', 'booking', `${asString(row.type) ?? 'booking'} ${asString(row.booking_ref) ?? asString(row.provider_ref) ?? ''}`)),
  ];

  return items
    .filter(item => item.at)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export async function GET(req: Request) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ error: 'Database is not configured' }, { status: 503 });
  }

  const url = new URL(req.url);
  const q = cleanQuery(url.searchParams.get('q'));
  if (q.length < 3) {
    return NextResponse.json({ error: 'Enter at least 3 characters' }, { status: 400 });
  }

  const maybeEmail = isEmail(q);
  const maybeUuid = isUuid(q);
  const maybePaymentId = /^(pi|cs|ch|seti)_/i.test(q);

  const sessions = await fetchRows('user_sessions', {
    session_id: `eq.${q}`,
    limit: 10,
  });

  const passengersByEmail = maybeEmail
    ? await fetchRows('passengers', { email: `eq.${q.toLowerCase()}`, order: 'created_at.desc', limit: 50 })
    : [];

  const legacyBookingsByRef = await fetchRows('bookings', {
    or: `(booking_ref.eq.${q},provider_ref.eq.${q})`,
    order: 'created_at.desc',
    limit: 20,
  });

  const legacyPaymentsByRef = await fetchRows('payments', {
    or: `(booking_ref.eq.${q},stripe_intent_id.eq.${q})`,
    order: 'created_at.desc',
    limit: 20,
  });

  const paymentQuotesById = maybeUuid
    ? await fetchRows('payment_quotes', { id: `eq.${q}`, limit: 1 })
    : [];

  const paymentTransactionsByProvider = maybePaymentId
    ? await fetchRows('payment_transactions', { provider_payment_id: `eq.${q}`, limit: 10 })
    : [];

  const supplierBookingsByRef = await fetchRows('supplier_bookings', {
    or: `(supplier_reference.eq.${q},supplier_booking_id.eq.${q},supplier_offer_id.eq.${q})`,
    order: 'created_at.desc',
    limit: 20,
  });

  const sessionIds = Array.from(new Set([
    q,
    ...collectIds(sessions, 'session_id'),
    ...collectIds(passengersByEmail, 'session_id'),
    ...collectIds(paymentQuotesById, 'session_id'),
  ].filter(Boolean)));

  const sessionFilter = inFilter(sessionIds);
  const searches = sessionFilter
    ? await fetchRows('search_logs', { session_id: sessionFilter, order: 'created_at.asc', limit: 200 })
    : [];
  const passengersBySession = sessionFilter
    ? await fetchRows('passengers', { session_id: sessionFilter, order: 'created_at.asc', limit: 100 })
    : [];

  const quotesBySession = sessionFilter
    ? await fetchRows('payment_quotes', { session_id: sessionFilter, order: 'created_at.asc', limit: 100 })
    : [];

  const quoteIds = Array.from(new Set([
    ...collectIds(paymentQuotesById, 'id'),
    ...collectIds(quotesBySession, 'id'),
    ...collectIds(paymentTransactionsByProvider, 'quote_id'),
    ...collectIds(supplierBookingsByRef, 'quote_id'),
  ]));
  const quoteFilter = inFilter(quoteIds);

  const paymentTransactionsByQuote = quoteFilter
    ? await fetchRows('payment_transactions', { quote_id: quoteFilter, order: 'created_at.asc', limit: 100 })
    : [];

  const paymentTransactions = [
    ...paymentTransactionsByProvider,
    ...paymentTransactionsByQuote,
  ].filter((row, index, all) => all.findIndex(other => other.id === row.id) === index);

  const transactionIds = collectIds(paymentTransactions, 'id');
  const transactionFilter = inFilter(transactionIds);

  const supplierBookingsByQuote = quoteFilter
    ? await fetchRows('supplier_bookings', { quote_id: quoteFilter, order: 'created_at.asc', limit: 100 })
    : [];
  const supplierBookingsByTransaction = transactionFilter
    ? await fetchRows('supplier_bookings', { payment_transaction_id: transactionFilter, order: 'created_at.asc', limit: 100 })
    : [];

  const supplierBookings = [
    ...supplierBookingsByRef,
    ...supplierBookingsByQuote,
    ...supplierBookingsByTransaction,
  ].filter((row, index, all) => all.findIndex(other => other.id === row.id) === index);

  const supplierBookingIds = collectIds(supplierBookings, 'id');
  const supplierBookingFilter = inFilter(supplierBookingIds);

  const ledgerByQuote = quoteFilter
    ? await fetchRows('ledger_entries', { quote_id: quoteFilter, order: 'created_at.asc', limit: 200 })
    : [];
  const ledgerByTransaction = transactionFilter
    ? await fetchRows('ledger_entries', { payment_transaction_id: transactionFilter, order: 'created_at.asc', limit: 200 })
    : [];
  const ledgerBySupplier = supplierBookingFilter
    ? await fetchRows('ledger_entries', { supplier_booking_id: supplierBookingFilter, order: 'created_at.asc', limit: 200 })
    : [];

  const base = {
    query: q,
    sessions: sanitizeRows(sessions),
    searches: sanitizeRows(searches),
    passengers: sanitizeRows([...passengersByEmail, ...passengersBySession]
      .filter((row, index, all) => all.findIndex(other => other.id === row.id) === index)),
    paymentQuotes: sanitizeRows([...paymentQuotesById, ...quotesBySession]
      .filter((row, index, all) => all.findIndex(other => other.id === row.id) === index)),
    paymentTransactions: sanitizeRows(paymentTransactions),
    supplierBookings: sanitizeRows(supplierBookings),
    ledgerEntries: sanitizeRows([...ledgerByQuote, ...ledgerByTransaction, ...ledgerBySupplier]
      .filter((row, index, all) => all.findIndex(other => other.id === row.id) === index)),
    legacyPayments: sanitizeRows(legacyPaymentsByRef),
    legacyBookings: sanitizeRows(legacyBookingsByRef),
  };

  return NextResponse.json({
    ...base,
    timeline: buildTimeline(base),
  } satisfies SupportLookupResult);
}
