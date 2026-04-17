// ─── Security Request Logger ─────────────────────────────────────────────────
// Non-blocking, fire-and-forget logger for security events.
// Writes to the `security_logs` Supabase table.
//
// Design principles:
//   • Never awaited — a logging failure must NEVER block a request
//   • No PII — only metadata: IP, path, method, status, session_id, event details
//   • Silently swallows errors (DB down, network issue, etc.)
//
// Event types:
//   rate_limit      — IP/session exceeded its rate limit
//   bot_block       — request blocked due to User-Agent pattern
//   geo_block       — request blocked by geo-restriction
//   burst_block     — IP exceeded burst threshold (50 req/10 s)
//   size_block      — Content-Length exceeded route limit
//   honeypot        — request hit a honeypot endpoint
//   circuit_open    — request rejected because circuit breaker is open
//   concurrent_drop — request dropped because concurrency queue timed out

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY  =
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  '';

export type SecurityEventType =
  | 'rate_limit'
  | 'bot_block'
  | 'geo_block'
  | 'burst_block'
  | 'size_block'
  | 'honeypot'
  | 'circuit_open'
  | 'concurrent_drop';

export interface SecurityLogEntry {
  event_type:   SecurityEventType;
  ip?:          string;
  path?:        string;
  method?:      string;
  status_code?: number;
  latency_ms?:  number;
  session_id?:  string;
  details?:     Record<string, unknown>;
}

/**
 * Log a security event to Supabase.
 * Fire-and-forget — never awaited, never throws.
 */
export function logSecurityEvent(entry: SecurityLogEntry): void {
  if (!SUPABASE_URL || !SERVICE_KEY) return;

  const url = `${SUPABASE_URL}/rest/v1/security_logs`;

  // Do not await — intentionally fire and forget
  fetch(url, {
    method:  'POST',
    headers: {
      apikey:         SERVICE_KEY,
      Authorization:  `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body:   JSON.stringify({ ...entry, created_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {
    // Silent — logging must never crash a request
  });
}

/**
 * Convenience wrapper for logging from Next.js middleware (Edge-compatible).
 * Accepts the same entry shape but uses the global fetch available in Edge.
 */
export function logSecurityEventEdge(entry: SecurityLogEntry): void {
  logSecurityEvent(entry);
}
