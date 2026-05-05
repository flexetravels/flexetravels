// ─── Honeypot Endpoint ────────────────────────────────────────────────────────
// Looks like an attractive admin/config endpoint to attackers and scanners.
// Any request that reaches here is DEFINITELY malicious — no legitimate user
// or system ever needs to call this path.
//
// On hit:
//   1. Logs full request details to security_logs (IP, all headers, body)
//   2. Records the attacker's IP into a local 1-hour block set
//   3. Returns a convincing fake response to waste the attacker's time
//
// The 1-hour block set is in-memory; persistent blocking requires the
// rate_limits table or an external WAF.

import { NextRequest, NextResponse } from 'next/server';
import { logSecurityEvent } from '@/lib/security/request-logger';

// In-memory block set: IP → blockedUntil (epoch ms)
// Route handlers share a process with other route handlers (not edge/middleware),
// so this state persists across requests within the same Railway dyno.
const honeypotBlocks = new Map<string, number>();

const BLOCK_DURATION_MS = 60 * 60 * 1_000;  // 1 hour

// Fake response body — looks plausible enough to keep scanners busy
const FAKE_RESPONSE = {
  version: '2.1.4',
  environment: 'production',
  config: {
    database: { host: 'db.internal', port: 5432, pool: 10 },
    cache:    { provider: 'redis', ttl: 300 },
    auth:     { secret: '[REDACTED]', algorithm: 'HS256', expiry: '7d' },
    stripe:   { mode: 'live', webhook_tolerance: 300 },
    features: {
      ddos_protection:  true,
      honeypot_enabled: true,
      geo_blocking:     false,
    },
  },
};

function getIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

async function handleHoneypot(req: NextRequest): Promise<NextResponse> {
  const ip      = getIP(req);
  const now     = Date.now();

  // Record the block
  honeypotBlocks.set(ip, now + BLOCK_DURATION_MS);

  // Collect headers (sanitized — no auth cookies forwarded to logs)
  const safeHeaders: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) {
    if (!['cookie', 'authorization'].includes(k.toLowerCase())) {
      safeHeaders[k] = v.slice(0, 200);
    }
  }

  // Try to read body (limited to 4 KB to prevent memory abuse)
  let body: string | null = null;
  try {
    const text = await req.text();
    body = text.slice(0, 4_096);
  } catch {
    // Ignore read errors
  }

  // Log the hit — fire and forget
  logSecurityEvent({
    event_type: 'honeypot',
    ip,
    path:       req.nextUrl.pathname,
    method:     req.method,
    details: {
      headers: safeHeaders,
      body:    body,
      ua:      req.headers.get('user-agent')?.slice(0, 200),
      blocked_until: new Date(now + BLOCK_DURATION_MS).toISOString(),
    },
  });

  console.warn(`[Honeypot] Hit from ${ip} — blocked for 1 hour. Path: ${req.nextUrl.pathname}`);

  // Slow response to waste attacker time (they're already blocked)
  await new Promise(r => setTimeout(r, 800));

  // Return convincing fake 200 response
  return NextResponse.json(FAKE_RESPONSE, {
    status: 200,
    headers: {
      'Cache-Control':  'no-store',
      'X-Request-ID':   crypto.randomUUID(),
      'Content-Type':   'application/json',
    },
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleHoneypot(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleHoneypot(req);
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  return handleHoneypot(req);
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  return handleHoneypot(req);
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  return handleHoneypot(req);
}

/** Returns the current set of honeypot-blocked IPs (for health/admin endpoints). */
function getHoneypotBlocks(): Map<string, number> {
  const now = Date.now();
  // Prune expired entries
  for (const [ip, until] of honeypotBlocks) {
    if (until < now) honeypotBlocks.delete(ip);
  }
  return honeypotBlocks;
}
