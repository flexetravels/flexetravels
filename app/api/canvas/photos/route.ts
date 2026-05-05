// ─── /api/canvas/photos?city=… ──────────────────────────────────────────────
// Returns a hero + 6-photo gallery for a destination city via the Unsplash
// search API. Used by the trip canvas DayLegBlock to render real photos for
// any leg the user adds — replaces the hardcoded photo IDs that went stale.
//
// Cache: in-memory 24h TTL inside fetchDestinationPhotos, plus a CDN/SWR
// hint on the response so Railway's edge can serve repeated requests for the
// same city without a roundtrip.

import { NextRequest, NextResponse } from 'next/server';
import { fetchDestinationPhotos } from '@/lib/canvas/unsplash-photos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_HEADERS = {
  // 24h shared cache + 24h stale-while-revalidate. Anything that gets hit
  // hourly stays warm without us doing anything.
  'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
};

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
};

export async function GET(req: NextRequest) {
  const city = (req.nextUrl.searchParams.get('city') ?? '').trim();
  if (!city || city.length < 2 || city.length > 100) {
    return NextResponse.json({ error: 'Missing or invalid city' }, { status: 400 });
  }

  const photos = await fetchDestinationPhotos(city);
  if (!photos) {
    // Do not cache misses. A transient Wikipedia/Unsplash/network miss should
    // not make a destination look blank for 24h.
    return NextResponse.json(
      { error: 'No live photos found for this destination yet.' },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(photos, { headers: CACHE_HEADERS });
}
