// lib/rate-limit.ts
// Sliding-window in-process rate limiter.
// Keys are arbitrary strings — combine IP + route or session + route as needed.
// Not shared across Railway instances; for multi-instance deployments, swap
// windows for a Redis-backed store.

interface RateWindow { count: number; resetAt: number }
const windows = new Map<string, RateWindow>();

/**
 * Returns true if the request is allowed, false if it should be rejected.
 * @param key        Unique key (e.g. `ip:stripe/prepare` or `session:chat`)
 * @param maxRequests Max allowed requests within the window
 * @param windowMs   Window size in milliseconds
 */
export function rateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || now > entry.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

/** Extract the client's IP from standard proxy headers. */
export function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

// Purge stale windows every minute to prevent unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows) {
    if (now > entry.resetAt) windows.delete(key);
  }
}, 60_000);
