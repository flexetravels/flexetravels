// ─── /api/search/hotels ──────────────────────────────────────────────────────
// Direct hotel search for the Trip Canvas. Wraps aggregateHotels.
// Gated by middleware (NEXT_PUBLIC_TRIP_CANVAS or ft_canvas cookie).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { aggregateHotels } from '@/lib/search/aggregator';
import { db, DB_AVAILABLE } from '@/lib/db/client';

export const runtime  = 'nodejs';
export const dynamic  = 'force-dynamic';
export const maxDuration = 30;

const Schema = z.object({
  sessionId:     z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
  tripCanvasId:  z.string().uuid().optional(),
  legId:         z.string().min(1).max(80).optional(),
  searchIntent:  z.string().min(1).max(200).optional(),
  destination:   z.string().min(2).max(80),
  checkIn:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults:        z.number().int().min(1).max(8).default(2),
  childrenAges:  z.array(z.number().int().min(0).max(17)).max(6).optional(),
  maxPrice:      z.number().positive().optional(),
  stars:         z.number().int().min(1).max(5).optional(),
  minRating:     z.number().min(0).max(10).optional(),
  amenities:     z.array(z.string()).max(15).optional(),
  freeCancellation: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await aggregateHotels(parsed.data);
    if (DB_AVAILABLE && parsed.data.sessionId) {
      db.searchLogs.create({
        session_id:       parsed.data.sessionId,
        trip_canvas_id:   parsed.data.tripCanvasId ?? null,
        leg_id:           parsed.data.legId ?? null,
        search_type:      'hotel',
        destination:      parsed.data.destination,
        depart_date:      parsed.data.checkIn,
        return_date:      parsed.data.checkOut,
        adults:           parsed.data.adults,
        children:         parsed.data.childrenAges?.length ?? 0,
        child_ages:       parsed.data.childrenAges ?? [],
        filters: {
          maxPrice: parsed.data.maxPrice,
          stars: parsed.data.stars,
          minRating: parsed.data.minRating,
          amenities: parsed.data.amenities,
          freeCancellation: parsed.data.freeCancellation,
        },
        request_payload:  {
          destination: parsed.data.destination,
          checkIn: parsed.data.checkIn,
          checkOut: parsed.data.checkOut,
          adults: parsed.data.adults,
          childrenAges: parsed.data.childrenAges,
        },
        provider_errors:  result.errors,
        result_count:     result.hotels.length,
        provider_sources: result.sources,
        latency_ms:       result.latencyMs,
        search_intent:    parsed.data.searchIntent ?? null,
      }).catch(() => {});
    }
    const sandbox = (process.env.LITEAPI_KEY ?? '').startsWith('sand_');
    return NextResponse.json({
      hotels:    result.hotels.slice(0, 30),
      sources:   result.sources,
      errors:    result.errors,
      latencyMs: result.latencyMs,
      sandbox,
    });
  } catch (err) {
    console.error('[/api/search/hotels] error:', err);
    return NextResponse.json(
      { error: 'Search failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 502 },
    );
  }
}
