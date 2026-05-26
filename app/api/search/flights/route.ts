import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aggregateFlights, NA_AIRPORTS } from '@/lib/search/aggregator';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { publicSearchWarnings } from '@/lib/public-errors';
import { db, DB_AVAILABLE } from '@/lib/db/client';

const AIRPORTS: Record<string, string> = {
  ...NA_AIRPORTS,
  cancun: 'CUN',
  'punta cana': 'PUJ',
  london: 'LHR',
  paris: 'CDG',
  rome: 'FCO',
  lisbon: 'LIS',
  barcelona: 'BCN',
  dubai: 'DXB',
  tokyo: 'NRT',
  bali: 'DPS',
  singapore: 'SIN',
  bangkok: 'BKK',
  amsterdam: 'AMS',
  frankfurt: 'FRA',
  istanbul: 'IST',
  doha: 'DOH',
};

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const schema = z.object({
  origin: z.string().min(2).max(80),
  destination: z.string().min(2).max(80),
  departureDate: DateString,
  returnDate: DateString.optional(),
  tripType: z.enum(['round_trip', 'one_way']).default('round_trip'),
  adults: z.number().int().min(1).max(9).default(1),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(8).default([]),
  cabinClass: z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
  maxConnections: z.number().int().min(0).max(2).optional(),
  sessionId: z.string().max(128).optional(),
  tripCanvasId: z.string().uuid().optional(),
  legId: z.string().max(80).optional(),
  searchIntent: z.string().max(160).optional(),
});

function resolveAirport(value: string): string | null {
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) return upper;
  return AIRPORTS[trimmed.toLowerCase()] ?? null;
}

function isFutureDate(value: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && date > today;
}

function sanitizeSessionId(input: string | undefined): string {
  return (input ?? `web_${Date.now()}`)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64) || 'anon';
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit(`ip:search-flights:${ip}`, 12, 60_000)) {
    return NextResponse.json({ error: 'Too many flight searches. Please try again shortly.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid flight search', details: parsed.error.flatten() }, { status: 400 });
  }

  const origin = resolveAirport(parsed.data.origin);
  const destination = resolveAirport(parsed.data.destination);
  if (!origin || !destination) {
    return NextResponse.json(
      { error: 'Please enter a valid airport code or a supported city name.' },
      { status: 400 },
    );
  }

  if (origin === destination) {
    return NextResponse.json({ error: 'Origin and destination must be different.' }, { status: 400 });
  }

  if (!isFutureDate(parsed.data.departureDate)) {
    return NextResponse.json({ error: 'Departure date must be in the future.' }, { status: 400 });
  }

  const returnDate = parsed.data.tripType === 'round_trip' ? parsed.data.returnDate : undefined;
  if (parsed.data.tripType === 'round_trip' && !returnDate) {
    return NextResponse.json({ error: 'Return date is required for round trips.' }, { status: 400 });
  }
  if (returnDate && new Date(returnDate) <= new Date(parsed.data.departureDate)) {
    return NextResponse.json({ error: 'Return date must be after departure date.' }, { status: 400 });
  }

  const childrenAges = parsed.data.childrenAges;
  const infants = childrenAges.filter(age => age < 2).length;
  const seatedChildren = childrenAges.filter(age => age >= 2 && age < 12);
  const teenAdults = childrenAges.filter(age => age >= 12).length;

  const result = await aggregateFlights({
    origin,
    destination,
    departureDate: parsed.data.departureDate,
    returnDate,
    adults: parsed.data.adults + teenAdults,
    childrenAges: seatedChildren,
    infants,
    cabinClass: parsed.data.cabinClass,
    maxConnections: parsed.data.maxConnections,
  });
  if (result.errors.length > 0) {
    console.warn('[/api/search/flights] internal provider errors', {
      origin,
      destination,
      errorCount: result.errors.length,
      errors: result.errors,
    });
  }
  const publicMessages = publicSearchWarnings('flight', result.errors, {
    hasResults: result.flights.length > 0,
  });
  const sessionId = sanitizeSessionId(parsed.data.sessionId);
  if (DB_AVAILABLE) {
    const uaHash = req.headers.get('user-agent')?.slice(0, 100) ?? undefined;
    db.userSessions.upsert(sessionId, uaHash).catch(() => {});
    db.searchLogs.create({
      session_id:       sessionId,
      search_type:      'flight',
      trip_canvas_id:   parsed.data.tripCanvasId ?? null,
      leg_id:           parsed.data.legId ?? null,
      origin,
      destination,
      depart_date:      parsed.data.departureDate,
      return_date:      returnDate ?? null,
      adults:           parsed.data.adults,
      children:         childrenAges.length,
      cabin_class:      parsed.data.cabinClass,
      child_ages:       childrenAges,
      filters:          {
        tripType: parsed.data.tripType,
        maxConnections: parsed.data.maxConnections ?? null,
      },
      request_payload:  {
        origin: parsed.data.origin,
        destination: parsed.data.destination,
        departureDate: parsed.data.departureDate,
        returnDate,
        adults: parsed.data.adults,
        childrenAges,
        cabinClass: parsed.data.cabinClass,
      },
      provider_errors:  result.errors,
      search_intent:    parsed.data.searchIntent ?? 'direct flight search',
      result_count:     result.flights.length,
      provider_sources: result.sources,
      latency_ms:       result.latencyMs,
      converted:        false,
    }).catch(e => console.warn('[/api/search/flights] search log write failed:', String(e)));
  }

  return NextResponse.json({
    flights: result.flights,
    sources: result.sources,
    errors: [],
    publicMessages,
    issueCount: result.errors.length,
    latencyMs: result.latencyMs,
    sessionId,
    query: {
      origin,
      destination,
      departureDate: parsed.data.departureDate,
      returnDate,
      adults: parsed.data.adults,
      childrenAges,
      cabinClass: parsed.data.cabinClass,
    },
  });
}
