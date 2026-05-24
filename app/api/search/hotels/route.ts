import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aggregateHotels } from '@/lib/search/aggregator';
import { getClientIp, rateLimit } from '@/lib/rate-limit';

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const schema = z.object({
  destination: z.string().min(2).max(80),
  checkIn: DateString,
  checkOut: DateString,
  adults: z.number().int().min(1).max(9).default(1),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(8).default([]),
  maxPrice: z.number().int().min(1).max(5000).optional(),
  stars: z.number().int().min(1).max(5).optional(),
});

function isFutureDate(value: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && date > today;
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

  return NextResponse.json({
    hotels: result.hotels,
    sources: result.sources,
    errors: result.errors,
    isSample: result.isSample,
    latencyMs: result.latencyMs,
    noResultsMessage: result.noResultsMessage,
    query: {
      destination: parsed.data.destination.trim(),
      checkIn: parsed.data.checkIn,
      checkOut: parsed.data.checkOut,
      adults: parsed.data.adults,
      childrenAges: parsed.data.childrenAges,
    },
  });
}
