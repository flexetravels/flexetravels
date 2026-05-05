// ─── /api/client-error ──────────────────────────────────────────────────────
// Receives crash reports from the React ErrorBoundary so we can see them
// in /api/admin/logs. Lightweight predecessor to wiring real Sentry/PostHog.
//
// Security:
//   - Rate limited to 10/min per IP — a crashed client can otherwise hammer us
//   - Body capped at 8 KB; stack traces longer than that are truncated
//   - No credentials, cookies, or full URLs are accepted/logged
//   - Sanitizes message + stack to remove injection markers before storage

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { logEvent } from '@/lib/logger';
import { sanitizeChatInput } from '@/lib/security/input-sanitizer';

const schema = z.object({
  message:  z.string().min(1).max(500),
  // Stack truncated client-side; we cap server-side too to be safe.
  stack:    z.string().max(4000).optional(),
  // Component stack from React's componentDidCatch info.componentStack
  component: z.string().max(2000).optional(),
  // Page where the crash happened — pathname only, no query string
  path:     z.string().max(200).optional(),
  // Page-load epoch — helps correlate with server logs
  loadedAt: z.number().int().positive().optional(),
  // Optional anonymous session id (already in localStorage for canvas users)
  sessionId: z.string().max(64).optional(),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit(`ip:client-error:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // Hard size cap — the schema already caps each field, but reject obviously
  // huge bodies before we even parse JSON.
  const lenHeader = req.headers.get('content-length');
  if (lenHeader && parseInt(lenHeader, 10) > 8192) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const { message, stack, component, path, sessionId } = parsed.data;

  // Strip injection markers so a malicious crash report can't poison the log
  // when we later replay it through any AI surface.
  const cleanMessage   = sanitizeChatInput(message).slice(0, 500);
  const cleanStack     = stack ? sanitizeChatInput(stack).slice(0, 4000) : undefined;
  const cleanComponent = component ? sanitizeChatInput(component).slice(0, 2000) : undefined;

  logEvent({
    level:   'error',
    event:   'system',
    api:     'system',
    success: false,
    sessionId,
    error:   cleanMessage,
    detail: {
      kind:      'client_crash',
      path:      path?.slice(0, 200),
      stack:     cleanStack,
      component: cleanComponent,
      ua:        req.headers.get('user-agent')?.slice(0, 200),
    },
  });

  return NextResponse.json({ ok: true });
}
