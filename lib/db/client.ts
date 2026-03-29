// ─── Supabase REST Client ─────────────────────────────────────────────────────
// Uses native fetch + Supabase PostgREST — zero extra npm packages.
// Set SUPABASE_URL + SUPABASE_SERVICE_KEY in env to activate persistence.
// Every method degrades gracefully (returns null / empty) when not configured.

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
// Accept either naming convention (Supabase dashboard uses SERVICE_ROLE_KEY)
const SERVICE_KEY  =
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  '';
const ANON_KEY     = process.env.SUPABASE_ANON_KEY ?? SERVICE_KEY;

export const DB_AVAILABLE = !!(SUPABASE_URL && SERVICE_KEY);

// Log DB status at startup so Railway logs make it obvious
if (typeof process !== 'undefined') {
  console.log('[DB] DB_AVAILABLE:', DB_AVAILABLE, '| URL:', SUPABASE_URL ? SUPABASE_URL.slice(0, 40) + '…' : '(not set)');
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

    if (res.status === 204) return null;
    return await res.json() as T;
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
    async redeem(id: string): Promise<void> {
      await rest('PATCH', 'credits', { filter: { id: `eq.${id}` }, body: { status: 'redeemed', redeemed_at: new Date().toISOString() } });
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

  // ── Search Logs (growth analytics) ───────────────────────────────────────
  searchLogs: {
    async create(data: Partial<SearchLogRow>): Promise<SearchLogRow | null> {
      const rows = await rest<SearchLogRow[]>('POST', 'search_logs', { body: data, returning: true });
      return rows?.[0] ?? null;
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

export interface SearchLogRow {
  id:               string;
  session_id:       string;
  search_type:      'flight' | 'hotel';
  origin:           string | null;
  destination:      string;
  depart_date:      string | null;
  return_date:      string | null;
  adults:           number;
  children:         number;
  result_count:     number;
  provider_sources: string[];
  latency_ms:       number | null;
  converted:        boolean;
  created_at:       string;
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
