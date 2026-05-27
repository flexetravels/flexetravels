import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aggregateHotels } from '@/lib/search/aggregator';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { publicSearchWarnings } from '@/lib/public-errors';
import { db, DB_AVAILABLE } from '@/lib/db/client';

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const schema = z.object({
  destination: z.string().min(2).max(80),
  checkIn: DateString,
  checkOut: DateString,
  adults: z.number().int().min(1).max(9).default(1),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(8).default([]),
  maxPrice: z.number().int().min(1).max(5000).optional(),
  stars: z.number().int().min(1).max(5).optional(),
  sessionId: z.string().max(128).optional(),
  tripCanvasId: z.string().uuid().optional(),
  legId: z.string().max(80).optional(),
  searchIntent: z.string().max(160).optional(),
});

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

function safeErrorCategory(errorCount: number, resultCount: number): string | null {
  if (errorCount <= 0) return null;
  return resultCount > 0 ? 'partial_provider_failure' : 'no_live_inventory';
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit(`ip:search-hotels:${ip}`, 12, 60_000)) {
    return NextResponse.json({ error: 'Too many hotel searches. Please try again shortly.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid hotel search', details: parsed.error.flatten() }, { status: 400 });
  }

  if (!isFutureDate(parsed.data.checkIn)) {
    return NextResponse.json({ error: 'Check-in date must be in the future.' }, { status: 400 });
  }
  if (new Date(parsed.data.checkOut) <= new Date(parsed.data.checkIn)) {
    return NextResponse.json({ error: 'Check-out date must be after check-in.' }, { status: 400 });
  }

  const result = await aggregateHotels({
    destination: parsed.data.destination.trim(),
    checkIn: parsed.data.checkIn,
    checkOut: parsed.data.checkOut,
    adults: parsed.data.adults,
    childrenAges: parsed.data.childrenAges,
    maxPrice: parsed.data.maxPrice,
    stars: parsed.data.stars,
  });
  if (result.errors.length > 0) {
    console.warn('[/api/search/hotels] internal provider errors', {
      destination: parsed.data.destination.trim(),
      errorCount: result.errors.length,
      errors: result.errors,
    });
  }
  const publicMessages = publicSearchWarnings('hotel', result.errors, {
    hasResults: result.hotels.length > 0,
    noResultsMessage: result.noResultsMessage,
  });
  const sessionId = sanitizeSessionId(parsed.data.sessionId);
  if (DB_AVAILABLE) {
    const uaHash = req.headers.get('user-agent')?.slice(0, 100) ?? undefined;
    db.userSessions.upsert(sessionId, uaHash).catch(() => {});
    db.searchLogs.create({
      session_id:       sessionId,
      search_type:      'hotel',
      trip_canvas_id:   parsed.data.tripCanvasId ?? null,
      leg_id:           parsed.data.legId ?? null,
      destination:      parsed.data.destination.trim(),
      depart_date:      parsed.data.checkIn,
      return_date:      parsed.data.checkOut,
      adults:           parsed.data.adults,
      children:         parsed.data.childrenAges.length,
      child_ages:       parsed.data.childrenAges,
      filters:          {
        maxPrice: parsed.data.maxPrice ?? null,
        stars: parsed.data.stars ?? null,
      },
      request_payload:  {
        destination: parsed.data.destination.trim(),
        checkIn: parsed.data.checkIn,
        checkOut: parsed.data.checkOut,
        adults: parsed.data.adults,
        childrenAges: parsed.data.childrenAges,
      },
      provider_errors:  result.errors,
      safe_error_category: safeErrorCategory(result.errors.length, result.hotels.length),
      search_intent:    parsed.data.searchIntent ?? 'direct hotel search',
      result_count:     result.hotels.length,
      provider_sources: result.sources,
      latency_ms:       result.latencyMs,
      converted:        false,
    }).catch(e => console.warn('[/api/search/hotels] search log write failed:', String(e)));
  }

  return NextResponse.json({
    hotels: result.hotels,
    sources: result.sources,
    errors: [],
    publicMessages,
    issueCount: result.errors.length,
    isSample: result.isSample,
    latencyMs: result.latencyMs,
    noResultsMessage: result.noResultsMessage,
    sessionId,
    query: {
      destination: parsed.data.destination.trim(),
      checkIn: parsed.data.checkIn,
      checkOut: parsed.data.checkOut,
      adults: parsed.data.adults,
      childrenAges: parsed.data.childrenAges,
    },
  });
}
