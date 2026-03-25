// ─── FlexeTravels Transaction Logger ─────────────────────────────────────────
// Writes structured JSON-lines to logs/transactions.jsonl for admin panel.
// Keeps the last 2,000 entries in memory for fast dashboard access.
// Safe to import in any API route — file I/O is fire-and-forget.

import * as fs   from 'fs';
import * as path from 'path';

// ─── Log entry types ──────────────────────────────────────────────────────────

export type LogLevel   = 'info' | 'warn' | 'error';
export type ApiSource  = 'duffel' | 'liteapi' | 'amadeus' | 'stripe' | 'gemini' | 'grok' | 'opentripmap' | 'foursquare' | 'unsplash' | 'system';
export type EventType  =
  | 'flight_search'
  | 'hotel_search'
  | 'experience_search'
  | 'flight_booking'
  | 'hotel_prebook'
  | 'hotel_booking'
  | 'stripe_payment'
  | 'offer_verify'
  | 'api_error'
  | 'system';

export interface LogEntry {
  id:         string;           // Unique ID (timestamp + random)
  ts:         string;           // ISO timestamp
  level:      LogLevel;
  event:      EventType;
  api:        ApiSource;
  sessionId?: string;
  durationMs?: number;

  // Search fields
  params?: Record<string, unknown>;   // Search params passed in
  resultCount?: number;               // How many results came back
  sources?: string[];                 // Which providers responded

  // Booking fields
  bookingRef?:  string;
  orderId?:     string;
  amount?:      number;
  currency?:    string;

  // Outcome
  success:  boolean;
  httpStatus?: number;
  errorCode?:  string;
  error?:   string;

  // Raw detail (truncated for safety)
  detail?: Record<string, unknown>;
}

// ─── In-memory ring buffer ────────────────────────────────────────────────────

const MAX_MEMORY_ENTRIES = 2_000;
const memoryLog: LogEntry[] = [];

// ─── File path ────────────────────────────────────────────────────────────────

const LOG_DIR  = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'transactions.jsonl');

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch { /* ignore */ }
}

// ─── ID generator ─────────────────────────────────────────────────────────────

let seq = 0;
function newId(): string {
  return `${Date.now()}-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Core log function ────────────────────────────────────────────────────────

export function logEvent(entry: Omit<LogEntry, 'id' | 'ts'>): LogEntry {
  const full: LogEntry = {
    id: newId(),
    ts: new Date().toISOString(),
    ...entry,
  };

  // Push to memory ring buffer
  memoryLog.push(full);
  if (memoryLog.length > MAX_MEMORY_ENTRIES) {
    memoryLog.splice(0, memoryLog.length - MAX_MEMORY_ENTRIES);
  }

  // Async write to file (fire-and-forget, never blocks request)
  setImmediate(() => {
    try {
      ensureLogDir();
      fs.appendFileSync(LOG_FILE, JSON.stringify(full) + '\n', 'utf8');
    } catch { /* non-fatal */ }
  });

  // Mirror to console for server logs
  const prefix = `[${full.event}][${full.api}]`;
  if (full.level === 'error') {
    console.error(prefix, full.error ?? full.detail);
  } else if (full.level === 'warn') {
    console.warn(prefix, full.detail ?? full.error);
  } else {
    console.log(prefix, full.success ? '✓' : '✗', full.detail ?? '');
  }

  return full;
}

// ─── Typed helpers ────────────────────────────────────────────────────────────

export const logger = {
  /** Log a completed API search (flights / hotels / experiences) */
  search(opts: {
    event:       'flight_search' | 'hotel_search' | 'experience_search';
    api:         ApiSource;
    sessionId?:  string;
    params:      Record<string, unknown>;
    resultCount: number;
    sources?:    string[];
    durationMs?: number;
    errors?:     string[];
    level?:      LogLevel;
  }) {
    return logEvent({
      event:       opts.event,
      api:         opts.api,
      level:       opts.level ?? (opts.errors?.length ? 'warn' : 'info'),
      sessionId:   opts.sessionId,
      params:      opts.params,
      resultCount: opts.resultCount,
      sources:     opts.sources,
      durationMs:  opts.durationMs,
      success:     opts.resultCount > 0,
      error:       opts.errors?.join(' | '),
      detail:      opts.errors?.length ? { errors: opts.errors } : undefined,
    });
  },

  /** Log a flight booking attempt (Duffel) */
  flightBooking(opts: {
    api:         'duffel';
    sessionId?:  string;
    offerId:     string;
    success:     boolean;
    bookingRef?: string;
    orderId?:    string;
    amount?:     number;
    currency?:   string;
    httpStatus?: number;
    errorCode?:  string;
    error?:      string;
    durationMs?: number;
  }) {
    return logEvent({
      event:      'flight_booking',
      api:        opts.api,
      level:      opts.success ? 'info' : 'error',
      sessionId:  opts.sessionId,
      success:    opts.success,
      bookingRef: opts.bookingRef,
      orderId:    opts.orderId,
      amount:     opts.amount,
      currency:   opts.currency,
      httpStatus: opts.httpStatus,
      errorCode:  opts.errorCode,
      error:      opts.error,
      durationMs: opts.durationMs,
      params:     { offerId: opts.offerId },
    });
  },

  /** Log a hotel prebook attempt (LiteAPI step 1) */
  hotelPrebook(opts: {
    api:            'liteapi';
    sessionId?:     string;
    offerId:        string;
    success:        boolean;
    prebookId?:     string;
    confirmedTotal?: number;
    currency?:      string;
    httpStatus?:    number;
    error?:         string;
    durationMs?:    number;
  }) {
    return logEvent({
      event:      'hotel_prebook',
      api:        opts.api,
      level:      opts.success ? 'info' : 'error',
      sessionId:  opts.sessionId,
      success:    opts.success,
      amount:     opts.confirmedTotal,
      currency:   opts.currency,
      httpStatus: opts.httpStatus,
      error:      opts.error,
      durationMs: opts.durationMs,
      params:     { offerId: opts.offerId },
      detail:     opts.prebookId ? { prebookId: opts.prebookId } : undefined,
    });
  },

  /** Log a hotel booking confirmation (LiteAPI step 2) */
  hotelBooking(opts: {
    api:        'liteapi';
    sessionId?: string;
    prebookId:  string;
    success:    boolean;
    bookingId?: string;
    hotelName?: string;
    amount?:    number;
    currency?:  string;
    httpStatus?: number;
    error?:     string;
    durationMs?: number;
  }) {
    return logEvent({
      event:      'hotel_booking',
      api:        opts.api,
      level:      opts.success ? 'info' : 'error',
      sessionId:  opts.sessionId,
      success:    opts.success,
      bookingRef: opts.bookingId,
      amount:     opts.amount,
      currency:   opts.currency,
      httpStatus: opts.httpStatus,
      error:      opts.error,
      durationMs: opts.durationMs,
      params:     { prebookId: opts.prebookId },
      detail:     opts.hotelName ? { hotelName: opts.hotelName } : undefined,
    });
  },

  /** Log a Stripe payment intent */
  stripePayment(opts: {
    sessionId?:  string;
    bookingRef:  string;
    amount:      number;
    currency:    string;
    success:     boolean;
    intentId?:   string;
    error?:      string;
  }) {
    return logEvent({
      event:      'stripe_payment',
      api:        'stripe',
      level:      opts.success ? 'info' : 'error',
      sessionId:  opts.sessionId,
      success:    opts.success,
      bookingRef: opts.bookingRef,
      amount:     opts.amount,
      currency:   opts.currency,
      orderId:    opts.intentId,
      error:      opts.error,
    });
  },

  /** Generic API error */
  apiError(api: ApiSource, error: string, detail?: Record<string, unknown>) {
    return logEvent({
      event:   'api_error',
      api,
      level:   'error',
      success: false,
      error,
      detail,
    });
  },
};

// ─── Query helpers ────────────────────────────────────────────────────────────

export interface LogQuery {
  event?:      EventType | EventType[];
  api?:        ApiSource;
  sessionId?:  string;
  success?:    boolean;
  since?:      string;   // ISO timestamp
  limit?:      number;
}

export function queryLogs(q: LogQuery = {}): LogEntry[] {
  let results = [...memoryLog].reverse(); // newest first

  if (q.since) {
    results = results.filter(e => e.ts >= q.since!);
  }
  if (q.event) {
    const events = Array.isArray(q.event) ? q.event : [q.event];
    results = results.filter(e => events.includes(e.event));
  }
  if (q.api) {
    results = results.filter(e => e.api === q.api);
  }
  if (q.sessionId) {
    results = results.filter(e => e.sessionId === q.sessionId);
  }
  if (q.success !== undefined) {
    results = results.filter(e => e.success === q.success);
  }

  return results.slice(0, q.limit ?? 500);
}

/** Aggregate stats for the dashboard */
export function getLogStats() {
  const now        = Date.now();
  const oneHourAgo = new Date(now - 3_600_000).toISOString();
  const recent     = memoryLog.filter(e => e.ts >= oneHourAgo);

  const byApi = (api: ApiSource, events: EventType[]) => {
    const entries = recent.filter(e => e.api === api && events.includes(e.event));
    const ok      = entries.filter(e => e.success).length;
    const fail    = entries.length - ok;
    const avgMs   = entries.length
      ? Math.round(entries.reduce((s, e) => s + (e.durationMs ?? 0), 0) / entries.length)
      : 0;
    return { total: entries.length, ok, fail, avgMs };
  };

  return {
    window:  '1h',
    total:   recent.length,
    memory:  memoryLog.length,
    apis: {
      duffel:      byApi('duffel',      ['flight_search', 'flight_booking', 'offer_verify']),
      liteapi:     byApi('liteapi',     ['hotel_search',  'hotel_prebook', 'hotel_booking']),
      amadeus:     byApi('amadeus',     ['flight_search', 'hotel_search']),
      stripe:      byApi('stripe',      ['stripe_payment']),
    },
    searches: {
      flights:     recent.filter(e => e.event === 'flight_search').length,
      hotels:      recent.filter(e => e.event === 'hotel_search').length,
      experiences: recent.filter(e => e.event === 'experience_search').length,
    },
    bookings: {
      flights: {
        total:  recent.filter(e => e.event === 'flight_booking').length,
        ok:     recent.filter(e => e.event === 'flight_booking' && e.success).length,
        failed: recent.filter(e => e.event === 'flight_booking' && !e.success).length,
      },
      hotels: {
        total:  recent.filter(e => e.event === 'hotel_booking').length,
        ok:     recent.filter(e => e.event === 'hotel_booking' && e.success).length,
        failed: recent.filter(e => e.event === 'hotel_booking' && !e.success).length,
      },
    },
    errors: recent.filter(e => e.level === 'error').slice(-20).reverse(),
  };
}

/** Read log file for entries not yet in memory (e.g. after restart) */
export function loadLogsFromFile(limit = 1000): LogEntry[] {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const lines = fs.readFileSync(LOG_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit);
    return lines.map(l => JSON.parse(l) as LogEntry).reverse();
  } catch {
    return [];
  }
}
