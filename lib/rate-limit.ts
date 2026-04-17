// ─── In-Memory Rate Limiter ───────────────────────────────────────────────────
// Sliding-window, per-process rate limiter.
// Keys are arbitrary strings — compose as `ip:route`, `session:route`, etc.
//
// Enhancements over the original:
//   • Fingerprint tracking: track by UA + Accept-Language hash in addition to IP
//   • Escalating penalties: after 3 violations the cooldown doubles
//   • getRateLimitInfo: returns remaining/resetAt for response headers
//   • buildFingerprint: stable cross-request identifier for the same browser
//
// Not distributed — for multi-instance deployments pair with
// lib/security/persistent-rate-limiter.ts (Supabase-backed).

interface RateWindow {
  count:      number;
  resetAt:    number;   // epoch ms when this window expires
  violations: number;   // times this key has been rate-limited
  blockedUntil: number; // epoch ms — escalating block; 0 = not blocked
}

const windows = new Map<string, RateWindow>();

// ─── Core rate-limit check ────────────────────────────────────────────────────

/**
 * Returns true if the request is allowed, false if it should be rejected.
 *
 * Escalating penalties:
 *   After 3 violations the block duration starts doubling with each rejection,
 *   capped at 24 hours.
 */
export function rateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now   = Date.now();
  const entry = windows.get(key);

  // No entry yet — first request
  if (!entry) {
    windows.set(key, { count: 1, resetAt: now + windowMs, violations: 0, blockedUntil: 0 });
    return true;
  }

  // Check escalating block first
  if (entry.blockedUntil > now) return false;

  // Window expired — start fresh
  if (now > entry.resetAt) {
    entry.count    = 1;
    entry.resetAt  = now + windowMs;
    return true;
  }

  // Within window — check count
  if (entry.count >= maxRequests) {
    entry.violations++;

    // Escalating block: base 60 s, doubles after 3rd violation, cap 24 h
    if (entry.violations >= 3) {
      const base    = 60_000;
      const factor  = Math.pow(2, entry.violations - 3);
      const blockMs = Math.min(base * factor, 86_400_000);
      entry.blockedUntil = now + blockMs;
    }

    return false;
  }

  entry.count++;
  return true;
}

// ─── Rate limit info (for headers) ───────────────────────────────────────────

export interface RateLimitInfo {
  remaining: number;
  resetAt:   number;    // epoch ms
  blocked:   boolean;
  retryAfterMs?: number;
}

/**
 * Returns current window state for a key without incrementing the counter.
 * Use to build X-RateLimit-* headers.
 */
export function getRateLimitInfo(key: string, maxRequests: number, windowMs: number): RateLimitInfo {
  const now   = Date.now();
  const entry = windows.get(key);

  if (!entry || now > entry.resetAt) {
    return { remaining: maxRequests, resetAt: now + windowMs, blocked: false };
  }

  if (entry.blockedUntil > now) {
    return {
      remaining:    0,
      resetAt:      entry.blockedUntil,
      blocked:      true,
      retryAfterMs: entry.blockedUntil - now,
    };
  }

  return {
    remaining: Math.max(0, maxRequests - entry.count),
    resetAt:   entry.resetAt,
    blocked:   entry.count >= maxRequests,
  };
}

// ─── IP extraction ────────────────────────────────────────────────────────────

/** Extract the client's IP from standard proxy headers. */
export function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

// ─── Browser fingerprint ──────────────────────────────────────────────────────

/**
 * Build a stable request fingerprint from User-Agent + Accept-Language.
 * Uses djb2 hash — works in both Node.js and Edge runtimes (no crypto needed).
 *
 * Pair with IP for a composite key:
 *   `${ip}:${buildFingerprint(req)}:chat`
 *
 * This catches cases where an attacker rotates IPs but uses the same browser.
 */
export function buildFingerprint(req: Request): string {
  const ua   = req.headers.get('user-agent') ?? '';
  const lang = req.headers.get('accept-language') ?? '';
  return djb2(ua + '|' + lang).toString(16);
}

/** djb2 hash — unsigned 32-bit, pure JS, no dependencies. */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h >>>= 0;  // keep unsigned 32-bit
  }
  return h;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
// Purge stale windows every minute to prevent unbounded memory growth.
// Only runs in Node.js (not Edge), which is where rate-limit.ts is called.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      if (now > entry.resetAt && now > entry.blockedUntil) {
        windows.delete(key);
      }
    }
  }, 60_000);
}
