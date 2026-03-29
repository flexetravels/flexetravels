// ─── Stripe Webhook Route (Consolidated) ─────────────────────────────────────
// All Stripe webhook handling is now in /api/webhooks/stripe.
// This route forwards any requests that still hit the old path.

import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  // Forward to canonical webhook handler
  const url = new URL('/api/webhooks/stripe', req.url);
  const res = await fetch(url.toString(), {
    method:  'POST',
    headers: req.headers,
    body:    await req.text(),
  });
  const body = await res.text();
  return new NextResponse(body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
