// ─── Shared Admin Auth Utility ─────────────────────────────────────────────────
// All admin and debug routes must use this function for authentication.
//
// Security rules:
//   1. If ADMIN_SECRET is not set in env → DENY (no secret = locked down)
//   2. Only accepts secret via x-admin-secret header — NOT query params
//      (query params appear in server logs, CDN caches, and browser history)
//   3. Timing-safe comparison to prevent timing attacks

export function checkAdminAuth(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET?.trim();

  // Default DENY if no secret configured — forces explicit setup in production
  if (!secret) return false;

  const provided = req.headers.get('x-admin-secret')?.trim() ?? '';

  // Constant-time comparison to avoid timing side-channel
  if (provided.length !== secret.length) return false;
  let mismatch = 0;
  for (let i = 0; i < secret.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return mismatch === 0;
}
