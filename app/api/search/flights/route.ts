// ─── /api/search/flights ─────────────────────────────────────────────────────
// Direct flight search for the Trip Canvas. Wraps lib/search/aggregator.ts,
// returns the same NormalizedFlight shape the chat tool returns. Used when
// the user clicks an empty flight slot in the canvas.
//
// Gated by middleware (NEXT_PUBLIC_TRIP_CANVAS or ft_canvas cookie), since
// it's only consumed by /trip/* pages.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { aggregateFlights } from '@/lib/search/aggregator';

export const runtime  = 'nodejs';
export const dynamic  = 'force-dynamic';
export const maxDuration = 30;

const IATA_RE = /^[A-Z]{3}$/;

const Schema = z.object({
  origin:        z.string().regex(IATA_RE),
  destination:   z.string().regex(IATA_RE),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  departureDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(14).optional(),
  returnDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  adults:        z.number().int().min(1).max(9).default(1),
  childrenAges:  z.array(z.number().int().min(0).max(17)).max(8).optional(),
  infants:       z.number().int().min(0).max(4).optional(),
  cabinClass:    z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
  maxConnections: z.number().int().min(0).max(3).optional(),
  avoidAirlines:  z.array(z.string()).max(20).optional(),
  viaRegions:     z.array(z.enum(['pacific', 'europe', 'middleeast'])).max(3).optional(),
  maxPrice:       z.number().positive().optional(),
  maxDurationMinutes: z.number().int().positive().optional(),
  departAfter:    z.string().regex(/^\d{2}:\d{2}$/).optional(),
  departBefore:   z.string().regex(/^\d{2}:\d{2}$/).optional(),
  transitProfile: z.object({
    passportCountry: z.string().regex(/^[A-Z]{2}$/).optional(),
    visaCountries: z.array(z.string().regex(/^[A-Z]{2}$|^EU$|^SCHENGEN$/)).max(30).optional(),
    mode: z.enum(['filter', 'warn']).optional(),
  }).optional(),
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
    const dates = parsed.data.departureDates && parsed.data.departureDates.length > 0
      ? Array.from(new Set(parsed.data.departureDates)).slice(0, 14)
      : [parsed.data.departureDate];

    const { departureDates: _departureDates, ...baseSearch } = parsed.data;
    const results = await Promise.allSettled(dates.map(departureDate => aggregateFlights({
      ...baseSearch,
      departureDate,
    })));

    const flights = results
      .flatMap(r => r.status === 'fulfilled' ? r.value.flights : [])
      .sort((a, b) => {
        const priceDelta = a.price - b.price;
        if (Math.abs(priceDelta) > 50) return priceDelta;
        return (a.durationMinutes ?? Number.MAX_SAFE_INTEGER) - (b.durationMinutes ?? Number.MAX_SAFE_INTEGER);
      });
    const sources = Array.from(new Set(results.flatMap(r => r.status === 'fulfilled' ? r.value.sources : [])));
    const errors = results.flatMap(r => r.status === 'fulfilled'
      ? r.value.errors
      : [r.reason instanceof Error ? r.reason.message : 'Search failed']
    );
    const latencyMs = results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value.latencyMs : 0), 0);
    // Surface sandbox mode so the client can show a "test data" badge when
    // the Duffel key is the sandbox token. Avoids users mistaking sandbox
    // mock prices/airlines for real availability.
    const sandbox = (process.env.DUFFEL_ACCESS_TOKEN ?? '').startsWith('duffel_test_');
    return NextResponse.json({
      flights:   flights.slice(0, 30),  // cap response size; client sorts/filters from here
      sources,
      errors,
      latencyMs,
      searchedDates: dates,
      sandbox,
    });
  } catch (err) {
    console.error('[/api/search/flights] error:', err);
    return NextResponse.json(
      { error: 'Search failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 502 },
    );
  }
}
