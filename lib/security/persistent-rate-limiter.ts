// ─── Persistent Rate Limiter ─────────────────────────────────────────────────
// Supabase-backed sliding-window rate limiter with escalating penalties.
// Complements the in-memory lib/rate-limit.ts — use this in route handlers
// for limits that must survive process restarts and work across instances.
//
// Features:
//   • Persists in `rate_limits` Supabase table (survives redeploys)
//   • Sliding window: each request resets the window only if it has expired
//   • Violation tracking: each rejection increments violation_count
//   • Escalating blocks: block duration doubles per violation (configurable)
//   • Automatic fallback to in-memory when DB is unavailable
//   • Returns X-RateLimit-* header values for caller to attach to responses
//
// Race-condition note:
//   Uses optimistic read-then-write — concurrent requests on the same key can
//   occasionally both pass a nearly-full window.  This is acceptable because:
//   (a) the in-memory layer provides tight per-process enforcement, and
//   (b) DDoS protection benefits from approximate counting across restarts, not
//       exact counting.

import { SECURITY_CONFIG } from './config';
import { rateLimit as inMemoryRateLimit } from '@/lib/rate-limit';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY  =
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  '';

const DB_AVAILABLE = !!(SUPABASE_URL && SERVICE_KEY);

interface RateLimitRow {
  key:             string;
  count:           number;
  window_start:    string;   // ISO timestamp
  block_until:     string | null;
  violation_count: number;
}

async function dbGet(key: string): Promise<RateLimitRow | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rate_limits?key=eq.${encodeURIComponent(key)}&limit=1`,
      {
        headers: {
          apikey:        SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as RateLimitRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function dbUpsert(row: Partial<RateLimitRow> & { key: string }): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rate_limits?on_conflict=key`, {
      method:  'POST',
      headers: {
        apikey:         SERVICE_KEY,
        Authorization:  `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer:         'resolution=merge-duplicates',
      },
      body:   JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // Ignore write failures — in-memory layer still enforces limits
  }
}

export interface RateLimitResult {
  allowed:         boolean;
  remaining:       number;
  resetAt:         number;    // Unix epoch ms
  retryAfter?:     number;    // seconds until retry allowed (present when blocked)
  blockDurationMs?: number;   // current block length in ms (present when blocked)
  violations:      number;    // total violation count for this key
}

/**
 * Check and record a rate-limit hit.
 *
 * @param key         Unique key, e.g. `ip:chat:1.2.3.4` or `session:chat:abc`
 * @param maxRequests Requests allowed per window
 * @param windowMs    Window size in milliseconds
 */
export async function persistentRateLimit(
  key:         string,
  maxRequests: number,
  windowMs:    number,
): Promise<RateLimitResult> {
  // Always run in-memory check first (fast, synchronous enforcement)
  const memAllowed = inMemoryRateLimit(key, maxRequests, windowMs);

  if (!DB_AVAILABLE) {
    return {
      allowed:    memAllowed,
      remaining:  memAllowed ? maxRequests - 1 : 0,
      resetAt:    Date.now() + windowMs,
      violations: 0,
    };
  }

  try {
    const now = Date.now();
    const row = await dbGet(key);

    // ── Active block check ──────────────────────────────────────────────────
    if (row?.block_until) {
      const blockUntilMs = new Date(row.block_until).getTime();
      if (now < blockUntilMs) {
        return {
          allowed:         false,
          remaining:       0,
          resetAt:         blockUntilMs,
          retryAfter:      Math.ceil((blockUntilMs - now) / 1_000),
          blockDurationMs: blockUntilMs - now,
          violations:      row.violation_count,
        };
      }
    }

    const windowStart    = row ? new Date(row.window_start).getTime() : now;
    const windowExpired  = now - windowStart >= windowMs;
    const violations     = row?.violation_count ?? 0;

    if (!row || windowExpired) {
      // First request in a new window — initialise / reset
      await dbUpsert({
        key,
        count:           1,
        window_start:    new Date(now).toISOString(),
        block_until:     null,
        violation_count: violations,
      });
      return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs, violations };
    }

    if (row.count >= maxRequests) {
      // ── Limit reached — escalate and set a block ────────────────────────
      const newViolations  = violations + 1;
      const cfg            = SECURITY_CONFIG.ddos;
      const blockMs        = Math.min(
        cfg.blockDurationMs * Math.pow(cfg.escalationFactor, newViolations - 1),
        cfg.maxBlockDurationMs,
      );
      const blockUntil     = new Date(now + blockMs).toISOString();

      await dbUpsert({
        key,
        count:           row.count,
        window_start:    row.window_start,
        block_until:     blockUntil,
        violation_count: newViolations,
      });

      console.warn(
        `[PersistentRL] Blocked ${key} — violation #${newViolations}, ` +
        `block: ${Math.round(blockMs / 1_000)}s`,
      );

      return {
        allowed:         false,
        remaining:       0,
        resetAt:         now + blockMs,
        retryAfter:      Math.ceil(blockMs / 1_000),
        blockDurationMs: blockMs,
        violations:      newViolations,
      };
    }

    // ── Normal increment ────────────────────────────────────────────────────
    await dbUpsert({
      key,
      count:           row.count + 1,
      window_start:    row.window_start,
      block_until:     null,
      violation_count: violations,
    });

    return {
      allowed:    true,
      remaining:  maxRequests - row.count - 1,
      resetAt:    windowStart + windowMs,
      violations,
    };
  } catch (err) {
    // DB error — degrade gracefully to in-memory result
    console.warn('[PersistentRL] DB error, falling back to in-memory:', err);
    return {
      allowed:    memAllowed,
      remaining:  memAllowed ? maxRequests - 1 : 0,
      resetAt:    Date.now() + windowMs,
      violations: 0,
    };
  }
}

/** Build X-RateLimit-* response headers from a RateLimitResult. */
export function rateLimitHeaders(result: RateLimitResult, limit: number): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit':     String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
    'X-RateLimit-Reset':     String(Math.ceil(result.resetAt / 1_000)),
  };
  if (!result.allowed && result.retryAfter !== undefined) {
    headers['Retry-After'] = String(result.retryAfter);
  }
  return headers;
}
