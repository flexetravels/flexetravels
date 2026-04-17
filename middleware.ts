// ─── Next.js Middleware ───────────────────────────────────────────────────────
// Runs on every non-static request BEFORE any route handler.
// Layers (evaluated in order — first match wins):
//
//   1. Supabase auth session refresh  (all routes)
//   2. Bot detection                  (API routes)
//   3. Geo-blocking                   (API routes, optional via ALLOWED_COUNTRIES)
//   4. Burst detection                (API routes — 50 req / 10 s → 5 min block)
//   5. Global rate limit              (API routes — 100 req / min per IP)
//   6. Request size limit             (POST/PUT/PATCH — checked via Content-Length)
//
// All checks use in-memory state (fast, no I/O).
// Persistent / distributed enforcement lives in route handlers via
// lib/security/persistent-rate-limiter.ts.

import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { SECURITY_CONFIG } from '@/lib/security/config';
import { logSecurityEventEdge } from '@/lib/security/request-logger';

// ─── In-memory state (per Edge worker) ───────────────────────────────────────

interface BurstRecord {
  count:        number;
  windowStart:  number;   // epoch ms
  blockedUntil: number;   // epoch ms (0 = not blocked)
  violations:   number;
}

const burstMap  = new Map<string, BurstRecord>();
const globalMap = new Map<string, { count: number; windowStart: number }>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** djb2 hash — pure JS, Edge + Node compatible. */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h >>>= 0;
  }
  return h;
}

function getIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function reject429(
  message: string,
  retryAfterSec: number,
  extraHeaders?: Record<string, string>,
): NextResponse {
  const res = NextResponse.json({ error: message }, { status: 429 });
  res.headers.set('Retry-After', String(retryAfterSec));
  res.headers.set('Cache-Control', 'no-store');
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) res.headers.set(k, v);
  }
  return res;
}

// ─── Layer 1: Bot detection ───────────────────────────────────────────────────

function checkBotUA(req: NextRequest, ip: string): NextResponse | null {
  const ua = req.headers.get('user-agent') ?? '';

  // Block requests with no User-Agent
  if (!ua.trim()) {
    logSecurityEventEdge({ event_type: 'bot_block', ip, path: req.nextUrl.pathname, method: req.method, details: { reason: 'empty_ua' } });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Allow legitimate search/social crawlers unconditionally
  for (const pattern of SECURITY_CONFIG.legitimateBots) {
    if (pattern.test(ua)) return null;
  }

  // Block known scanner / scraper User-Agents
  for (const pattern of SECURITY_CONFIG.knownBotPatterns) {
    if (pattern.test(ua)) {
      logSecurityEventEdge({ event_type: 'bot_block', ip, path: req.nextUrl.pathname, method: req.method, details: { ua: ua.slice(0, 120), pattern: pattern.source } });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  return null;
}

// ─── Layer 2: Geo-blocking ────────────────────────────────────────────────────

function checkGeo(req: NextRequest, ip: string): NextResponse | null {
  const allowed = process.env.ALLOWED_COUNTRIES;
  if (!allowed) return null;  // feature not enabled

  const allowedSet = new Set(allowed.toUpperCase().split(',').map(c => c.trim()).filter(Boolean));
  if (!allowedSet.size) return null;

  let country: string | null = null;
  for (const header of SECURITY_CONFIG.geoHeaders) {
    const val = req.headers.get(header);
    if (val && val !== 'XX') { country = val.toUpperCase(); break; }
  }

  if (!country) return null;  // no geo header — let through (not behind Cloudflare)
  if (country === 'XX') return null;  // unknown country — allow

  if (!allowedSet.has(country)) {
    logSecurityEventEdge({ event_type: 'geo_block', ip, path: req.nextUrl.pathname, method: req.method, details: { country } });
    return NextResponse.json({ error: 'Not available in your region' }, { status: 403 });
  }

  return null;
}

// ─── Layer 3: Burst detection ─────────────────────────────────────────────────

function checkBurst(ip: string, pathname: string): NextResponse | null {
  const cfg = SECURITY_CONFIG.ddos;
  const now = Date.now();

  let rec = burstMap.get(ip);
  if (!rec) {
    rec = { count: 1, windowStart: now, blockedUntil: 0, violations: 0 };
    burstMap.set(ip, rec);
    return null;
  }

  // Still under an escalating block?
  if (rec.blockedUntil > now) {
    const retryAfter = Math.ceil((rec.blockedUntil - now) / 1_000);
    return reject429('Too many requests', retryAfter);
  }

  // Roll the burst window if expired
  if (now - rec.windowStart >= cfg.burstWindowMs) {
    rec.count       = 1;
    rec.windowStart = now;
    return null;
  }

  rec.count++;

  if (rec.count > cfg.burstThreshold) {
    rec.violations++;
    const blockMs      = Math.min(
      cfg.blockDurationMs * Math.pow(cfg.escalationFactor, rec.violations - 1),
      cfg.maxBlockDurationMs,
    );
    rec.blockedUntil = now + blockMs;
    const retryAfter = Math.ceil(blockMs / 1_000);

    logSecurityEventEdge({
      event_type: 'burst_block',
      ip,
      path:       pathname,
      details:    {
        count:      rec.count,
        violations: rec.violations,
        blockSec:   retryAfter,
      },
    });

    return reject429('Too many requests', retryAfter);
  }

  return null;
}

// ─── Layer 4: Global rate limit (100 req / min per IP) ───────────────────────

function checkGlobalRateLimit(ip: string): NextResponse | null {
  const { maxRequests, windowMs } = SECURITY_CONFIG.rateLimits.global;
  const now = Date.now();

  let rec = globalMap.get(ip);
  if (!rec || now - rec.windowStart >= windowMs) {
    globalMap.set(ip, { count: 1, windowStart: now });
    return null;
  }

  if (rec.count >= maxRequests) {
    const resetAt    = rec.windowStart + windowMs;
    const retryAfter = Math.ceil((resetAt - now) / 1_000);
    return reject429('Rate limit exceeded', retryAfter, {
      'X-RateLimit-Limit':     String(maxRequests),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset':     String(Math.ceil(resetAt / 1_000)),
    });
  }

  rec.count++;
  return null;
}

// ─── Layer 5: Request size (Content-Length check) ─────────────────────────────

function checkRequestSize(req: NextRequest): NextResponse | null {
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return null;

  const contentLength = req.headers.get('content-length');
  if (!contentLength) return null;  // no header — can't check without consuming body

  const bytes    = parseInt(contentLength, 10);
  if (isNaN(bytes) || bytes < 0) return null;

  const pathname = req.nextUrl.pathname;
  const limit    =
    SECURITY_CONFIG.requestSizeLimits[pathname] ??
    SECURITY_CONFIG.requestSizeLimits.default;

  if (bytes > limit) {
    const ip = getIP(req);
    logSecurityEventEdge({
      event_type: 'size_block',
      ip,
      path:       pathname,
      method,
      details:    { bytes, limit },
    });
    return NextResponse.json(
      { error: `Request body too large (max ${limit} bytes)` },
      { status: 413 },
    );
  }

  return null;
}

// ─── Periodic cleanup (Edge-safe — runs opportunistically on each request) ───

let lastCleanup = 0;
function maybeCleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;

  for (const [k, rec] of burstMap) {
    if (now - rec.windowStart > SECURITY_CONFIG.ddos.maxBlockDurationMs && rec.blockedUntil < now) {
      burstMap.delete(k);
    }
  }
  for (const [k, rec] of globalMap) {
    if (now - rec.windowStart > SECURITY_CONFIG.rateLimits.global.windowMs * 2) {
      globalMap.delete(k);
    }
  }
}

// ─── Fingerprint-based bot pattern detection ──────────────────────────────────
// Detects same browser fingerprint cycling IPs.  Works by tracking UA+lang
// hash across requests — logged only, not blocked (would produce false positives).

const fingerprintSessionMap = new Map<string, Set<string>>();  // fp → Set<ip>

function trackFingerprint(req: NextRequest, ip: string): void {
  const ua   = req.headers.get('user-agent') ?? '';
  const lang = req.headers.get('accept-language') ?? '';
  if (!ua) return;

  const fp   = djb2(ua + '|' + lang).toString(16);
  let ips    = fingerprintSessionMap.get(fp);
  if (!ips) {
    ips = new Set();
    fingerprintSessionMap.set(fp, ips);
  }
  ips.add(ip);

  // Flag when the same fingerprint is seen from many IPs (distributed bot)
  if (ips.size === 10) {
    logSecurityEventEdge({
      event_type: 'burst_block',
      ip,
      details:    { reason: 'fingerprint_ip_rotation', fp, ip_count: ips.size },
    });
  }
}

// ─── Main middleware ──────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  maybeCleanup();

  const pathname = request.nextUrl.pathname;
  const ip       = getIP(request);

  // Only apply DDoS layers to API routes (pages and static files are excluded
  // by the matcher below, but this adds clarity and safety).
  if (isApiRoute(pathname)) {
    // Layer: bot detection
    const botBlock = checkBotUA(request, ip);
    if (botBlock) return botBlock;

    // Layer: geo-blocking (opt-in via ALLOWED_COUNTRIES env var)
    const geoBlock = checkGeo(request, ip);
    if (geoBlock) return geoBlock;

    // Layer: burst detection
    trackFingerprint(request, ip);
    const burstBlock = checkBurst(ip, pathname);
    if (burstBlock) return burstBlock;

    // Layer: global rate limit
    const globalBlock = checkGlobalRateLimit(ip);
    if (globalBlock) return globalBlock;

    // Layer: request size
    const sizeBlock = checkRequestSize(request);
    if (sizeBlock) return sizeBlock;
  }

  // Supabase auth session refresh (keeps auth cookies fresh)
  const response = await updateSession(request);

  // Attach Cache-Control to all API responses (belt-and-suspenders alongside next.config.js)
  if (isApiRoute(pathname)) {
    response.headers.set('Cache-Control', 'no-store, max-age=0');
  }

  return response;
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals and static file extensions.
    // API routes, pages, and the root are all included.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
