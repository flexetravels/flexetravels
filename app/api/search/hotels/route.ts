// ─── /api/search/hotels ──────────────────────────────────────────────────────
// Direct hotel search for the Trip Canvas. Wraps aggregateHotels.
// Gated by middleware (NEXT_PUBLIC_TRIP_CANVAS or ft_canvas cookie).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { aggregateHotels } from '@/lib/search/aggregator';

export const runtime  = 'nodejs';
export const dynamic  = 'force-dynamic';
export const maxDuration = 30;

const Schema = z.object({
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
