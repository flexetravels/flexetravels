// ─── Supabase REST Client ─────────────────────────────────────────────────────
// Uses native fetch + Supabase PostgREST — zero extra npm packages.
// Set SUPABASE_URL + SUPABASE_SERVICE_KEY in env to activate persistence.
// Every method degrades gracefully (returns null / empty) when not configured.

import type { TripCanvasRow } from '@/lib/canvas/types';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
// Accept either naming convention (Supabase dashboard uses SERVICE_ROLE_KEY)
const SERVICE_KEY  =
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  '';

export const DB_AVAILABLE = !!(SUPABASE_URL && SERVICE_KEY);

// Log DB status at startup without exposing provider host details in logs.
if (typeof process !== 'undefined') {
  console.log('[DB] DB_AVAILABLE:', DB_AVAILABLE);
}

// ─── Low-level helpers ────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
type Filter = Record<string, unknown>;   // e.g. { id: 'eq.abc', status: 'eq.active' }

function buildQuery(filter?: Filter): string {
  if (!filter) return '';
  return '?' + Object.entries(filter)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function rest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  table:  string,
  opts:   { filter?: Filter; body?: Json | Json[]; select?: string; returning?: boolean } = {},
): Promise<T | null> {
  if (!DB_AVAILABLE) return null;

  const qs = buildQuery({
    ...(opts.filter ?? {}),
    ...(opts.select ? { select: opts.select } : {}),
  });

  const url = `${SUPABASE_URL}/rest/v1/${table}${qs}`;

  const headers: HeadersInit = {
    apikey:        SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (opts.returning) {
    (headers as Record<string, string>)['Prefer'] = 'return=representation';
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[DB] ${method} ${table} failed ${res.status}:`, err.slice(0, 200));
      return null;
    }

    // 204 No Content has no body. 201 Created CAN have a body when the caller
    // sent `Prefer: return=representation` (i.e. `returning: true`). Don't
    // short-circuit on 201 — parse the body if present so inserts that pass
    // `returning: true` actually return the inserted row.
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (e) {
    console.error(`[DB] ${method} ${table} exception:`, e);
    return null;
  }
}

// ─── Public DB interface ──────────────────────────────────────────────────────

export const db = {
  // ── Trips ──────────────────────────────────────────────────────────────────
  trips: {
    async create(data: Partial<TripRow>): Promise<TripRow | null> {
      const rows = await rest<TripRow[]>('POST', 'trips', { body: data, returning: true });
      return rows?.[0] ?? null;
    },
    async get(id: string): Promise<TripRow | null> {
      const rows = await rest<TripRow[]>('GET', 'trips', { filter: { id: `eq.${id}` } });
      return rows?.[0] ?? null;
    },
    async getBySession(sessionId: string): Promise<TripRow | null> {
      const rows = await rest<TripRow[]>('GET', 'trips', {
        filter: { session_id: `eq.${sessionId}`, status: 'neq.archived' },
        select: '*',
      });
      return rows?.[0] ?? null;
    },
    async update(id: string, data: Partial<TripRow>): Promise<TripRow | null> {
      const rows = await rest<TripRow[]>('PATCH', 'trips', {
        filter: { id: `eq.${id}` }, body: data, returning: true,
      });
      return rows?.[0] ?? null;
    },
  },

  // ── Bookings ───────────────────────────────────────────────────────────────
  bookings: {
    async create(data: Partial<BookingRow>): Promise<BookingRow | null> {
      const rows = await rest<BookingRow[]>('POST', 'bookings', { body: data, returning: true });
      return rows?.[0] ?? null;
    },
    async get(id: string): Promise<BookingRow | null> {
      const rows = await rest<BookingRow[]>('GET', 'bookings', { filter: { id: `eq.${id}` } });
      return rows?.[0] ?? null;
    },
    async getByTrip(tripId: string): Promise<BookingRow[]> {
      return await rest<BookingRow[]>('GET', 'bookings', { filter: { trip_id: `eq.${tripId}` } }) ?? [];
    },
    async getByRef(ref: string): Promise<BookingRow | null> {
      const rows = await rest<BookingRow[]>('GET', 'bookings', { filter: { provider_ref: `eq.${ref}` } });
      return rows?.[0] ?? null;
    },
    async getByBookingRef(ref: string): Promise<BookingRow | null> {
      const rows = await rest<BookingRow[]>('GET', 'bookings', { filter: { booking_ref: `eq.${ref}` } });
      return rows?.[0] ?? null;
    },
    async update(id: string, data: Partial<BookingRow>): Promise<BookingRow | null> {
      const rows = await rest<BookingRow[]>('PATCH', 'bookings', {
        filter: { id: `eq.${id}` }, body: data, returning: true,
      });
      return rows?.[0] ?? null;
    },
  },

  // ── Events (webhook + disruption log) ─────────────────────────────────────
  events: {
    async insert(data: Partial<EventRow>): Promise<EventRow | null> {
      const rows = await rest<EventRow[]>('POST', 'events', { body: data, returning: true });
      return rows?.[0] ?? null;
    },
    async getByBooking(bookingId: string, limit = 50): Promise<EventRow[]> {
      return await rest<EventRow[]>('GET', 'events', {
        filter: { booking_id: `eq.${bookingId}`, order: 'created_at.desc', limit: String(limit) },
      }) ?? [];
    },
  },

  // ── Credits ────────────────────────────────────────────────────────────────
  credits: {
    async create(data: Partial<CreditRow>): Promise<CreditRow | null> {
      const rows = await rest<CreditRow[]>('POST', 'credits', { body: data, returning: true });
      return rows?.[0] ?? null;
    },
    async getBySession(sessionId: string): Promise<CreditRow[]> {
      return await rest<CreditRow[]>('GET', 'credits', {
        filter: { session_id: `eq.${sessionId}`, status: 'eq.available' },
      }) ?? [];
    },
    /**
     * Atomically redeem a credit by filtering on both id AND status = 'available'.
     * Returns true if the credit was successfully redeemed, false if it was
     * already redeemed by a concurrent request (race condition defence).
     *
     * The PostgREST PATCH only touches rows matching ALL filter conditions, so
     * two concurrent calls for the same id will produce at most one winner.
     */
    async redeem(id: string): Promise<boolean> {
      const rows = await rest<CreditRow[]>('PATCH', 'credits', {
        filter: { id: `eq.${id}`, status: 'eq.available' },  // conditional on still-available
        body: { status: 'redeemed', redeemed_at: new Date().toISOString() },
        returning: true,
      });
      return !!(rows && rows.length > 0);
    },
  },

  // ── Automation Scripts ─────────────────────────────────────────────────────
  automationScripts: {
    async get(airline: string, actionType: string): Promise<AutomationScriptRow | null> {
      const rows = await rest<AutomationScriptRow[]>('GET', 'automation_scripts', {
        filter: {
          airline:     `eq.${airline}`,
          action_type: `eq.${actionType}`,
          active:      'eq.true',
        },
        select: '*',
      });
      // Return highest version
      return rows?.sort((a, b) => b.version - a.version)?.[0] ?? null;
    },
    async upsert(data: Partial<AutomationScriptRow>): Promise<AutomationScriptRow | null> {
      // Try update first, then insert
      const existing = data.airline && data.action_type
        ? await rest<AutomationScriptRow[]>('GET', 'automation_scripts', {
            filter: { airline: `eq.${data.airline}`, action_type: `eq.${data.action_type}` },
          })
        : null;

      if (existing && existing.length > 0) {
        const rows = await rest<AutomationScriptRow[]>('PATCH', 'automation_scripts', {
          filter: { id: `eq.${existing[0].id}` },
          body:   { ...data, updated_at: new Date().toISOString() },
          returning: true,
        });
        return rows?.[0] ?? null;
      }

      const rows = await rest<AutomationScriptRow[]>('POST', 'automation_scripts', {
        body:      data,
        returning: true,
      });
      return rows?.[0] ?? null;
    },
    async updateConfidence(id: string, confidence: number): Promise<void> {
      await rest('PATCH', 'automation_scripts', {
        filter: { id: `eq.${id}` },
        body:   { confidence, updated_at: new Date().toISOString() },
      });
    },
  },

  // ── Payments (Stripe persistence) ──────────────────────────────────────────
  payments: {
    async create(data: Partial<PaymentRow>): Promise<PaymentRow | null> {
      const rows = await rest<PaymentRow[]>('POST', 'payments', { body: data, returning: true });
      return rows?.[0] ?? null;
    },
    async getByRef(bookingRef: string): Promise<PaymentRow | null> {
      const rows = await rest<PaymentRow[]>('GET', 'payments', { filter: { booking_ref: `eq.${bookingRef}` } });
      return rows?.[0] ?? null;
    },
    async getByIntentId(intentId: string): Promise<PaymentRow | null> {
      const rows = await rest<PaymentRow[]>('GET', 'payments', { filter: { stripe_intent_id: `eq.${intentId}` } });
      return rows?.[0] ?? null;
    },
  },

  // ── Payment ledger v2 (quote/idempotency/reconciliation) ──────────────────
  paymentQuotes: {
    async create(data: Partial<PaymentQuoteRow>): Promise<PaymentQuoteRow | null> {
      const rows = await rest<PaymentQuoteRow[]>('POST', 'payment_quotes', { body: data as Json, returning: true });
      return rows?.[0] ?? null;
    },
    async get(id: string): Promise<PaymentQuoteRow | null> {
      const rows = await rest<PaymentQuoteRow[]>('GET', 'payment_quotes', { filter: { id: `eq.${id}` } });
      return rows?.[0] ?? null;
    },
    async consumeOpen(id: string): Promise<PaymentQuoteRow | null> {
      const rows = await rest<PaymentQuoteRow[]>('PATCH', 'payment_quotes', {
        filter: { id: `eq.${id}`, status: 'eq.open' },
        body: { status: 'consumed', consumed_at: new Date().toISOString() },
        returning: true,
      });
      return rows?.[0] ?? null;
    },
  },

  paymentTransactions: {
    async create(data: Partial<PaymentTransactionRow>): Promise<PaymentTransactionRow | null> {
      const rows = await rest<PaymentTransactionRow[]>('POST', 'payment_transactions', { body: data as Json, returning: true });
      return rows?.[0] ?? null;
    },
    async getByProviderPaymentId(provider: string, providerPaymentId: string): Promise<PaymentTransactionRow | null> {
      const rows = await rest<PaymentTransactionRow[]>('GET', 'payment_transactions', {
        filter: {
          provider: `eq.${provider}`,
          provider_payment_id: `eq.${providerPaymentId}`,
        },
      });
      return rows?.[0] ?? null;
    },
  },

  supplierBookings: {
    async create(data: Partial<SupplierBookingRow>): Promise<SupplierBookingRow | null> {
      const rows = await rest<SupplierBookingRow[]>('POST', 'supplier_bookings', { body: data as Json, returning: true });
      return rows?.[0] ?? null;
    },
  },

  ledgerEntries: {
    async createMany(rows: Array<Partial<LedgerEntryRow>>): Promise<void> {
      if (!rows.length) return;
      await rest('POST', 'ledger_entries', { body: rows as Json[] });
    },
  },

  // ── Search Logs (growth analytics) ───────────────────────────────────────
  searchLogs: {
    async create(data: Partial<SearchLogRow>): Promise<SearchLogRow | null> {
      const rows = await rest<SearchLogRow[]>('POST', 'search_logs', { body: data, returning: true });
      return rows?.[0] ?? null;
    },
  },

  // ── AI + Product Analytics ───────────────────────────────────────────────
  aiInteractions: {
    async create(data: Partial<AiInteractionRow>): Promise<AiInteractionRow | null> {
      const rows = await rest<AiInteractionRow[]>('POST', 'ai_interactions', { body: data as Json, returning: true });
      return rows?.[0] ?? null;
    },
  },

  tripActivityEvents: {
    async create(data: Partial<TripActivityEventRow>): Promise<TripActivityEventRow | null> {
      const rows = await rest<TripActivityEventRow[]>('POST', 'trip_activity_events', { body: data as Json, returning: true });
      return rows?.[0] ?? null;
    },
  },

  customerPreferenceSignals: {
    async create(data: Partial<CustomerPreferenceSignalRow>): Promise<CustomerPreferenceSignalRow | null> {
      const rows = await rest<CustomerPreferenceSignalRow[]>('POST', 'customer_preference_signals', { body: data as Json, returning: true });
      return rows?.[0] ?? null;
    },
    async createMany(rows: Array<Partial<CustomerPreferenceSignalRow>>): Promise<void> {
      if (!rows.length) return;
      await rest('POST', 'customer_preference_signals', { body: rows as Json[] });
    },
  },

  // ── User Sessions (anonymous engagement) ─────────────────────────────────
  userSessions: {
    async upsert(sessionId: string, userAgentHash?: string): Promise<void> {
      if (!DB_AVAILABLE) return;
      const existing = await rest<UserSessionRow[]>('GET', 'user_sessions', {
        filter: { session_id: `eq.${sessionId}` },
      });
      if (existing && existing.length > 0) {
        await rest('PATCH', 'user_sessions', {
          filter: { session_id: `eq.${sessionId}` },
          body: {
            last_seen_at:    new Date().toISOString(),
            total_searches:  (existing[0].total_searches ?? 0) + 1,
          },
        });
      } else {
        await rest('POST', 'user_sessions', {
          body: {
            session_id:      sessionId,
            user_agent_hash: userAgentHash ?? null,
            total_searches:  1,
          },
        });
      }
    },
    async incrementBookings(sessionId: string): Promise<void> {
      if (!DB_AVAILABLE) return;
      const existing = await rest<UserSessionRow[]>('GET', 'user_sessions', {
        filter: { session_id: `eq.${sessionId}` },
      });
      if (existing && existing.length > 0) {
        await rest('PATCH', 'user_sessions', {
          filter: { session_id: `eq.${sessionId}` },
          body: {
            last_seen_at:    new Date().toISOString(),
            total_bookings:  (existing[0].total_bookings ?? 0) + 1,
          },
        });
      }
    },
  },

  // ── Passengers (PII — stored for booking verification) ────────────────────
  passengers: {
    async insertMany(rows: Omit<PassengerRow, 'id' | 'created_at'>[]): Promise<void> {
      if (!rows.length) return;
      await rest('POST', 'passengers', { body: rows as unknown as Json[] });
    },
  },

  // ── Trip Canvas (v2 visual canvas — additive) ─────────────────────────────
  tripsCanvas: {
    async create(data: Partial<TripCanvasRow>): Promise<TripCanvasRow | null> {
      const rows = await rest<TripCanvasRow[]>('POST', 'trips_canvas', { body: data, returning: true });
      return rows?.[0] ?? null;
    },
    async get(id: string): Promise<TripCanvasRow | null> {
      const rows = await rest<TripCanvasRow[]>('GET', 'trips_canvas', { filter: { id: `eq.${id}` } });
      return rows?.[0] ?? null;
    },
    async listBySession(sessionId: string, limit = 20): Promise<TripCanvasRow[]> {
      return await rest<TripCanvasRow[]>('GET', 'trips_canvas', {
        filter: { session_id: `eq.${sessionId}`, status: 'neq.archived', order: 'updated_at.desc', limit: String(limit) },
      }) ?? [];
    },
    async update(id: string, data: Partial<TripCanvasRow>): Promise<TripCanvasRow | null> {
      const rows = await rest<TripCanvasRow[]>('PATCH', 'trips_canvas', {
        filter: { id: `eq.${id}` }, body: data, returning: true,
      });
      return rows?.[0] ?? null;
    },
    async archive(id: string): Promise<void> {
      await rest('PATCH', 'trips_canvas', {
        filter: { id: `eq.${id}` },
        body:   { status: 'archived' },
      });
    },
  },

  // ── Execution Logs ─────────────────────────────────────────────────────────
  executionLogs: {
    async create(data: Partial<ExecutionLogRow>): Promise<ExecutionLogRow | null> {
      const rows = await rest<ExecutionLogRow[]>('POST', 'execution_logs', {
        body:      data,
        returning: true,
      });
      return rows?.[0] ?? null;
    },
    async getByScript(scriptId: string, limit = 20): Promise<ExecutionLogRow[]> {
      return await rest<ExecutionLogRow[]>('GET', 'execution_logs', {
        filter: {
          script_id: `eq.${scriptId}`,
          order:     'created_at.desc',
          limit:     String(limit),
        },
      }) ?? [];
    },
    async getByBooking(bookingId: string): Promise<ExecutionLogRow[]> {
      return await rest<ExecutionLogRow[]>('GET', 'execution_logs', {
        filter: { booking_id: `eq.${bookingId}`, order: 'created_at.desc' },
      }) ?? [];
    },
  },
};

// ─── Row types ────────────────────────────────────────────────────────────────

// TripCanvas row type re-exported for convenience (defined in lib/canvas/types).
export type { TripCanvasRow };


export interface TripRow {
  id:          string;
  session_id:  string;
  status:      'planning' | 'booked' | 'cancelled' | 'disrupted' | 'archived';
  origin:      string;
  destination: string;
  depart_date: string;
  return_date: string | null;
  adults:      number;
  children:    number;
  cabin_class: string;
  check_in:    string | null;
  check_out:   string | null;
  metadata:    Record<string, unknown> | null;
  created_at:  string;
  updated_at:  string;
}

export interface BookingRow {
  id:             string;
  trip_id:        string;
  type:           'flight' | 'hotel';
  provider:       'duffel' | 'liteapi';
  status:         'pending' | 'confirmed' | 'cancelled' | 'failed' | 'disrupted';
  provider_ref:   string;           // Duffel order ID / LiteAPI booking ID
  booking_ref:    string | null;    // PNR / booking reference shown to customer
  amount_cents:   number;
  currency:       string;
  flexibility_score: number | null; // 0–1
  flexibility_label: 'Flexible' | 'Moderate' | 'Locked' | null;
  offer_id:       string | null;    // Original offer ID used to book
  raw_conditions: Record<string, unknown> | null;  // Duffel conditions object
  passenger_ids:  string[];
  metadata:       Record<string, unknown> | null;
  created_at:     string;
  updated_at:     string;
}

export interface EventRow {
  id:          string;
  booking_id:  string | null;
  trip_id:     string | null;
  source:      'duffel_webhook' | 'liteapi_webhook' | 'system' | 'user';
  type:        string;              // e.g. 'order.flight_disrupted', 'order.cancelled'
  payload:     Record<string, unknown>;
  processed:   boolean;
  created_at:  string;
}

export interface CreditRow {
  id:          string;
  session_id:  string;
  booking_id:  string | null;
  amount_cents: number;
  currency:    string;
  reason:      string;
  status:      'available' | 'redeemed' | 'expired';
  expires_at:  string | null;
  redeemed_at: string | null;
  created_at:  string;
}

export interface AutomationScriptRow {
  id:            string;
  airline:       string;
  action_type:   string;
  version:       number;
  steps:         Record<string, unknown>[];
  selectors:     Record<string, string>;
  confidence:    number;
  last_verified: string | null;
  active:        boolean;
  created_at:    string;
  updated_at:    string;
}

export interface PaymentRow {
  id:                string;
  stripe_intent_id:  string | null;
  stripe_session_id: string | null;
  booking_ref:       string;
  amount_cents:      number;
  currency:          string;
  status:            'succeeded' | 'failed' | 'refunded';
  paid_at:           string;
  created_at:        string;
}

export interface PaymentQuoteRow {
  id:                  string;
  session_id:          string;
  trip_canvas_id:      string | null;
  market:              'CA' | 'US' | 'IN' | 'OTHER';
  strategy:            'duffel_payments_markup' | 'stripe_balance' | 'razorpay_balance' | 'supplier_direct';
  merchant_of_record:  string;
  supplier:            string;
  fare_amount_cents:   number;
  fare_currency:       string;
  fee_amount_cents:    number;
  fee_currency:        string;
  charge_amount_cents: number;
  charge_currency:     string;
  offer_ids:           string[];
  cart_hash:           string;
  caveats:             string[];
  expires_at:          string;
  status:              'open' | 'consumed' | 'expired' | 'cancelled';
  metadata:            Record<string, unknown>;
  created_at:          string;
  consumed_at:         string | null;
}

export interface PaymentTransactionRow {
  id:                    string;
  quote_id:              string;
  provider:              'stripe' | 'razorpay' | 'duffel';
  provider_payment_id:   string;
  idempotency_key:       string;
  status:                'created' | 'requires_action' | 'succeeded' | 'failed' | 'refunding' | 'refunded' | 'partially_refunded';
  amount_cents:          number;
  currency:              string;
  expected_amount_cents: number;
  expected_currency:     string;
  failure_reason:        string | null;
  raw_payload:           Record<string, unknown>;
  created_at:            string;
  updated_at:            string;
}

export interface SupplierBookingRow {
  id:                     string;
  quote_id:               string;
  payment_transaction_id: string | null;
  leg_index:              number;
  supplier:               'duffel' | 'liteapi' | 'amadeus' | 'travelport' | 'manual';
  product_type:           'flight' | 'hotel' | 'activity' | 'insurance';
  supplier_offer_id:      string | null;
  supplier_booking_id:    string | null;
  supplier_reference:     string | null;
  status:                 'pending' | 'confirmed' | 'failed' | 'cancelled' | 'requires_action' | 'refund_due' | 'refunded';
  amount_cents:           number;
  currency:               string;
  failure_reason:         string | null;
  raw_request:            Record<string, unknown>;
  raw_response:           Record<string, unknown>;
  created_at:             string;
  updated_at:             string;
}

export interface LedgerEntryRow {
  id:                     string;
  quote_id:               string | null;
  payment_transaction_id: string | null;
  supplier_booking_id:    string | null;
  account:                'customer_cash' | 'stripe_cash' | 'razorpay_cash' | 'duffel_balance' | 'supplier_payable' | 'service_fee_revenue' | 'refund_payable';
  direction:              'debit' | 'credit';
  amount_cents:           number;
  currency:               string;
  memo:                   string | null;
  created_at:             string;
}

export interface SearchLogRow {
  id:               string;
  session_id:       string;
  search_type:      'flight' | 'hotel';
  trip_canvas_id:   string | null;
  leg_id:           string | null;
  origin:           string | null;
  destination:      string;
  depart_date:      string | null;
  return_date:      string | null;
  adults:           number;
  children:         number;
  cabin_class:      string | null;
  child_ages:       number[];
  flexible_dates:   string[];
  filters:          Record<string, unknown>;
  request_payload:  Record<string, unknown>;
  provider_errors:  string[];
  search_intent:    string | null;
  selected_result_id: string | null;
  result_count:     number;
  provider_sources: string[];
  latency_ms:       number | null;
  converted:        boolean;
  created_at:       string;
}

export interface AiInteractionRow {
  id:             string;
  session_id:     string;
  trip_canvas_id: string | null;
  surface:        'chat' | 'canvas_command' | 'command_bar' | 'system';
  model:          string | null;
  user_message:   string | null;
  sanitized:      boolean;
  history_turns:  number;
  state_before:   Record<string, unknown>;
  state_after:    Record<string, unknown>;
  ops:            Record<string, unknown>[];
  response_text:  string | null;
  tool_summary:   Record<string, unknown>;
  clarification:  boolean;
  error:          string | null;
  latency_ms:     number | null;
  created_at:     string;
}

export interface TripActivityEventRow {
  id:             string;
  session_id:     string;
  trip_canvas_id: string | null;
  event_type:     string;
  leg_id:         string | null;
  payload:        Record<string, unknown>;
  created_at:     string;
}

export interface CustomerPreferenceSignalRow {
  id:             string;
  session_id:     string;
  trip_canvas_id: string | null;
  signal_type:    string;
  signal_value:   string;
  confidence:     number;
  source:         'vibe' | 'canvas' | 'chat' | 'search' | 'checkout' | 'booking';
  metadata:       Record<string, unknown>;
  created_at:     string;
}

export interface UserSessionRow {
  session_id:       string;
  first_seen_at:    string;
  last_seen_at:     string;
  user_agent_hash:  string | null;
  total_searches:   number;
  total_bookings:   number;
  metadata:         Record<string, unknown> | null;
  created_at:       string;
}

export interface PassengerRow {
  id:            string;
  session_id:    string;
  booking_id:    string | null;
  type:          'adult' | 'child' | 'infant';
  title:         string | null;
  first_name:    string;
  last_name:     string;
  date_of_birth: string;
  gender:        string | null;
  nationality:   string | null;
  email:         string | null;
  phone:         string | null;
  created_at:    string;
}

export interface ExecutionLogRow {
  id:              string;
  script_id:       string | null;
  booking_id:      string | null;
  airline:         string;
  action_type:     string;
  success:         boolean;
  duration_ms:     number | null;
  error:           string | null;
  steps_completed: number | null;
  total_steps:     number | null;
  created_at:      string;
}
