#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL and SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const sessionArg = args.get('--session');
const emailArg = args.get('--email');
const paymentArg = args.get('--payment-intent');

function qs(params) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') out.set(key, String(value));
  }
  return out.toString();
}

async function table(name, params) {
  const url = `${SUPABASE_URL}/rest/v1/${name}?${qs({ select: '*', ...params })}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${name} failed ${res.status}: ${text.slice(0, 180)}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function idList(rows, key) {
  return [...new Set(rows.map(row => row[key]).filter(Boolean))];
}

function inFilter(values) {
  const clean = [...new Set(values.filter(Boolean))];
  if (!clean.length) return null;
  return `in.(${clean.map(value => `"${String(value).replaceAll('"', '')}"`).join(',')})`;
}

function amount(row) {
  const cents = row.charge_amount_cents ?? row.amount_cents ?? row.fare_amount_cents;
  const currency = row.charge_currency ?? row.currency ?? row.fare_currency;
  if (typeof cents !== 'number' || !currency) return null;
  return `${(cents / 100).toFixed(2)} ${String(currency).toUpperCase()}`;
}

function summarize(label, rows) {
  console.log(`\n${label}: ${rows.length}`);
  for (const row of rows.slice(0, 8)) {
    const parts = [
      row.created_at || row.first_seen_at || row.paid_at,
      row.status,
      row.search_type,
      row.origin && row.destination ? `${row.origin}->${row.destination}` : row.destination,
      row.provider_payment_id || row.stripe_intent_id,
      row.supplier_reference || row.supplier_booking_id || row.booking_ref || row.provider_ref,
      row.recipient_email,
      amount(row),
    ].filter(Boolean);
    console.log(`- ${parts.join(' · ')}`);
  }
}

async function main() {
  let sessions = [];
  let passengers = [];
  let paymentsByProvider = [];
  let emailsByEmail = [];

  if (sessionArg) {
    sessions = await table('user_sessions', { session_id: `eq.${sessionArg}`, limit: 1 });
  } else if (emailArg) {
    passengers = await table('passengers', { email: `eq.${emailArg.toLowerCase()}`, order: 'created_at.desc', limit: 25 });
    emailsByEmail = await table('customer_emails', { recipient_email: `eq.${emailArg.toLowerCase()}`, order: 'created_at.desc', limit: 25 });
  } else if (paymentArg) {
    paymentsByProvider = await table('payment_transactions', { provider_payment_id: `eq.${paymentArg}`, limit: 5 });
  } else {
    sessions = await table('user_sessions', { order: 'last_seen_at.desc', limit: 1 });
  }

  const sessionIds = [
    sessionArg,
    ...idList(sessions, 'session_id'),
    ...idList(passengers, 'session_id'),
    ...idList(emailsByEmail, 'session_id'),
  ].filter(Boolean);

  const sessionFilter = inFilter(sessionIds);
  const searches = sessionFilter ? await table('search_logs', { session_id: sessionFilter, order: 'created_at.asc', limit: 100 }) : [];
  const paymentQuotes = sessionFilter ? await table('payment_quotes', { session_id: sessionFilter, order: 'created_at.asc', limit: 100 }) : [];
  const quoteFilter = inFilter([...idList(paymentQuotes, 'id'), ...idList(paymentsByProvider, 'quote_id')]);
  const paymentTransactions = quoteFilter
    ? await table('payment_transactions', { quote_id: quoteFilter, order: 'created_at.asc', limit: 100 })
    : paymentsByProvider;
  const txFilter = inFilter(idList(paymentTransactions, 'id'));
  const supplierBookings = quoteFilter
    ? await table('supplier_bookings', { quote_id: quoteFilter, order: 'created_at.asc', limit: 100 })
    : [];
  const supplierFilter = inFilter(idList(supplierBookings, 'id'));
  const ledgerByQuote = quoteFilter ? await table('ledger_entries', { quote_id: quoteFilter, order: 'created_at.asc', limit: 100 }) : [];
  const ledgerByTx = txFilter ? await table('ledger_entries', { payment_transaction_id: txFilter, order: 'created_at.asc', limit: 100 }) : [];
  const ledgerBySupplier = supplierFilter ? await table('ledger_entries', { supplier_booking_id: supplierFilter, order: 'created_at.asc', limit: 100 }) : [];
  const customerEmails = sessionFilter
    ? await table('customer_emails', { session_id: sessionFilter, order: 'created_at.asc', limit: 100 })
    : emailsByEmail;

  console.log('FlexeTravels funnel verification');
  console.log(`Session(s): ${sessionIds.join(', ') || '(none resolved)'}`);
  summarize('Sessions', sessions);
  summarize('Search logs', searches);
  summarize('Payment quotes', paymentQuotes);
  summarize('Payment transactions', paymentTransactions);
  summarize('Supplier bookings', supplierBookings);
  summarize('Ledger entries', [...ledgerByQuote, ...ledgerByTx, ...ledgerBySupplier]);
  summarize('Customer emails', customerEmails);

  const missing = [];
  if (!sessionIds.length) missing.push('session');
  if (!searches.length) missing.push('search_logs');
  if (!paymentQuotes.length) missing.push('payment_quotes');
  if (!paymentTransactions.length) missing.push('payment_transactions');
  if (!supplierBookings.length) missing.push('supplier_bookings');
  if (![...ledgerByQuote, ...ledgerByTx, ...ledgerBySupplier].length) missing.push('ledger_entries');
  if (!customerEmails.length) missing.push('customer_emails');

  console.log(`\nReadiness summary: ${missing.length ? `missing ${missing.join(', ')}` : 'complete funnel records found'}`);
  process.exit(missing.length ? 1 : 0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
