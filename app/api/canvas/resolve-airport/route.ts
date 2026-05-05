// ─── /api/canvas/resolve-airport?q=… ────────────────────────────────────────
// Live IATA resolver backed by Duffel /places/suggestions. Returns the best
// match plus up to 10 ranked alternates so the AddLegDialog can render an
// autocomplete dropdown when the input is ambiguous (e.g. "San Jose").

import { NextRequest, NextResponse } from 'next/server';
import { resolveAirport, resolveAirportSuggestions } from '@/lib/canvas/airport-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Authoritative results — Duffel maintains them. Cache for 24h at the edge.
const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
};

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q || q.length < 2 || q.length > 80) {
    return NextResponse.json({ error: 'Missing or invalid q' }, { status: 400 });
  }

  const [best, suggestions] = await Promise.all([
    resolveAirport(q),
    resolveAirportSuggestions(q),
  ]);

  if (!best) {
    return NextResponse.json(
      { error: 'No matching airport', query: q, suggestions: [] },
      { status: 404, headers: CACHE_HEADERS },
    );
  }
  return NextResponse.json({ best, suggestions }, { headers: CACHE_HEADERS });
}
