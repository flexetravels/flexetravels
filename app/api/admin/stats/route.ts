// ─── Admin: Aggregate Stats API ───────────────────────────────────────────────
// GET /api/admin/stats
// Returns API health summary, booking success rates, search counts for last 1h.

import { NextResponse } from 'next/server';
import { getLogStats } from '@/lib/logger';
import { checkAdminAuth } from '@/lib/auth';
import { getFlightCacheStats } from '@/lib/search/flightCache';
import { getHotelCacheStats } from '@/lib/search/hotelCache';

export async function GET(req: Request) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    ...getLogStats(),
    flightCache: getFlightCacheStats(),
    hotelCache:  getHotelCacheStats(),
  });
}
