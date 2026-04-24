// ─── /api/fx ───────────────────────────────────────────────────────────────
// Returns daily USD → * exchange rates. Proxies frankfurter.app via the
// server-side lib/fx/rates cache so the client never hits the upstream directly
// (gives us one upgrade point if we ever swap provider, and keeps the token
// budget clean).

import { NextResponse } from 'next/server';
import { getRates } from '@/lib/fx/rates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const rates = await getRates();
  return NextResponse.json(rates, {
    headers: {
      // Cache in the browser for 6h; our server cache is 24h.
      // Stale rates are fine for display — this is never used for actual money movement.
      'Cache-Control': 'public, max-age=21600, stale-while-revalidate=86400',
    },
  });
}
