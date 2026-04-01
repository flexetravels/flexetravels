// ─── Duffel Child/Infant Passenger Debug Endpoint ─────────────────────────────
// GET /api/debug/duffel-children?secret=YOUR_ADMIN_SECRET
//
// Tests the Duffel sandbox API with child and infant passengers on known-bookable
// routes. Returns offer counts per passenger mix to confirm whether the transparent
// childFareNote fallback is needed for real routes.
//
// Gated behind ADMIN_SECRET — safe to leave deployed.

import { NextResponse } from 'next/server';

const DUFFEL_BASE = 'https://api.duffel.com';

type Passenger =
  | { type: 'adult' }
  | { type: 'child'; age: number }
  | { type: 'infant_without_seat' };

interface TestCase {
  label:       string;
  origin:      string;
  destination: string;
  passengers:  Passenger[];
}

interface TestResult {
  label:      string;
  route:      string;
  passengers: string;
  offerCount: number;
  cheapest:   string | null;
  httpStatus: number | null;
  error:      string | null;
  latencyMs:  number;
  fallbackWouldTrigger: boolean;  // true when child/infant search → 0 offers
}

function passengerSummary(passengers: Passenger[]): string {
  const counts: Record<string, number> = {};
  for (const p of passengers) {
    const key = p.type === 'child' ? `child(age ${p.age})` : p.type;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts).map(([k, v]) => `${v}×${k}`).join(', ');
}

async function testSearch(
  token: string,
  testCase: TestCase,
  departDate: string
): Promise<TestResult> {
  const headers = {
    Authorization:    `Bearer ${token}`,
    'Duffel-Version': 'v2',
    'Content-Type':   'application/json',
    Accept:           'application/json',
  };

  const body = JSON.stringify({
    data: {
      slices:      [{ origin: testCase.origin, destination: testCase.destination, departure_date: departDate }],
      passengers:  testCase.passengers,
      cabin_class: 'economy',
    },
  });

  const start = Date.now();
  const passengerStr = passengerSummary(testCase.passengers);
  const hasChildOrInfant = testCase.passengers.some(
    p => p.type === 'child' || p.type === 'infant_without_seat'
  );

  try {
    const res = await fetch(`${DUFFEL_BASE}/air/offer_requests?return_offers=true`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(18_000),
    });
    const latencyMs = Date.now() - start;
    const json = await res.json() as {
      data?: { offers?: Array<{ id: string; total_amount: string; total_currency: string; owner?: { name: string } }> };
      errors?: Array<{ message: string; code: string }>;
    };

    if (!res.ok) {
      const errMsg = json?.errors?.[0]?.message ?? `HTTP ${res.status}`;
      return {
        label:      testCase.label,
        route:      `${testCase.origin}→${testCase.destination}`,
        passengers: passengerStr,
        offerCount: 0,
        cheapest:   null,
        httpStatus: res.status,
        error:      errMsg,
        latencyMs,
        fallbackWouldTrigger: false,
      };
    }

    const offers = json?.data?.offers ?? [];
    const cheapestOffer = offers[0];
    const cheapest = cheapestOffer
      ? `${cheapestOffer.total_currency} ${cheapestOffer.total_amount} via ${cheapestOffer.owner?.name ?? 'unknown'}`
      : null;

    return {
      label:      testCase.label,
      route:      `${testCase.origin}→${testCase.destination}`,
      passengers: passengerStr,
      offerCount: offers.length,
      cheapest,
      httpStatus: res.status,
      error:      null,
      latencyMs,
      fallbackWouldTrigger: hasChildOrInfant && offers.length === 0,
    };
  } catch (err) {
    return {
      label:      testCase.label,
      route:      `${testCase.origin}→${testCase.destination}`,
      passengers: passengerStr,
      offerCount: 0,
      cheapest:   null,
      httpStatus: null,
      error:      String(err),
      latencyMs:  Date.now() - start,
      fallbackWouldTrigger: false,
    };
  }
}

export async function GET(req: Request) {
  // ── Auth gate ────────────────────────────────────────────────────────────────
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret) {
    const { searchParams } = new URL(req.url);
    const provided = req.headers.get('x-admin-secret') ?? searchParams.get('secret');
    if (provided !== adminSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: 'DUFFEL_ACCESS_TOKEN not set' }, { status: 503 });

  // Depart ~4 weeks out so sandbox routes have availability
  const departDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 28);
    return d.toISOString().split('T')[0];
  })();

  const testCases: TestCase[] = [
    // ── YYZ → CUN (Cancun — verified sandbox route) ──────────────────────────
    { label: 'YYZ→CUN — 2 adults only',               origin: 'YYZ', destination: 'CUN', passengers: [{ type: 'adult' }, { type: 'adult' }] },
    { label: 'YYZ→CUN — 2 adults + child age 5',      origin: 'YYZ', destination: 'CUN', passengers: [{ type: 'adult' }, { type: 'adult' }, { type: 'child', age: 5 }] },
    { label: 'YYZ→CUN — 2 adults + child age 2',      origin: 'YYZ', destination: 'CUN', passengers: [{ type: 'adult' }, { type: 'adult' }, { type: 'child', age: 2 }] },
    { label: 'YYZ→CUN — 2 adults + infant (lap)',      origin: 'YYZ', destination: 'CUN', passengers: [{ type: 'adult' }, { type: 'adult' }, { type: 'infant_without_seat' }] },
    { label: 'YYZ→CUN — 2 adults + child 5 + infant', origin: 'YYZ', destination: 'CUN', passengers: [{ type: 'adult' }, { type: 'adult' }, { type: 'child', age: 5 }, { type: 'infant_without_seat' }] },
    { label: 'YYZ→CUN — 2 adults + toddler 2 + infant', origin: 'YYZ', destination: 'CUN', passengers: [{ type: 'adult' }, { type: 'adult' }, { type: 'child', age: 2 }, { type: 'infant_without_seat' }] },

    // ── YYZ → JFK (New York — known sandbox route) ───────────────────────────
    { label: 'YYZ→JFK — 2 adults only',               origin: 'YYZ', destination: 'JFK', passengers: [{ type: 'adult' }, { type: 'adult' }] },
    { label: 'YYZ→JFK — 2 adults + child age 7',      origin: 'YYZ', destination: 'JFK', passengers: [{ type: 'adult' }, { type: 'adult' }, { type: 'child', age: 7 }] },
    { label: 'YYZ→JFK — 2 adults + infant (lap)',      origin: 'YYZ', destination: 'JFK', passengers: [{ type: 'adult' }, { type: 'adult' }, { type: 'infant_without_seat' }] },
    { label: 'YYZ→JFK — 2 adults + child 4 + infant', origin: 'YYZ', destination: 'JFK', passengers: [{ type: 'adult' }, { type: 'adult' }, { type: 'child', age: 4 }, { type: 'infant_without_seat' }] },

    // ── YYZ → PUJ (Punta Cana) ───────────────────────────────────────────────
    { label: 'YYZ→PUJ — 2 adults only',               origin: 'YYZ', destination: 'PUJ', passengers: [{ type: 'adult' }, { type: 'adult' }] },
    { label: 'YYZ→PUJ — 2 adults + child age 4',      origin: 'YYZ', destination: 'PUJ', passengers: [{ type: 'adult' }, { type: 'adult' }, { type: 'child', age: 4 }] },
    { label: 'YYZ→PUJ — 2 adults + infant (lap)',      origin: 'YYZ', destination: 'PUJ', passengers: [{ type: 'adult' }, { type: 'adult' }, { type: 'infant_without_seat' }] },
  ];

  // Run all tests — sequential to avoid hammering Duffel rate limits
  const results: TestResult[] = [];
  for (const tc of testCases) {
    const r = await testSearch(token, tc, departDate);
    results.push(r);
  }

  // ── Compute summary ──────────────────────────────────────────────────────────
  const totalSearches = results.length;
  const withOffers    = results.filter(r => r.offerCount > 0).length;
  const zeroOffers    = results.filter(r => r.error === null && r.offerCount === 0).length;
  const apiErrors     = results.filter(r => r.error !== null).length;
  const fallbackCases = results.filter(r => r.fallbackWouldTrigger);

  const verdict = fallbackCases.length > 0
    ? `⚠️ ${fallbackCases.length} child/infant search(es) returned 0 offers — childFareNote fallback WILL trigger. Affected: ${fallbackCases.map(r => r.label).join('; ')}`
    : apiErrors > 0
      ? `❌ API errors on ${apiErrors} searches — check token/connectivity`
      : `✅ All child/infant searches returned offers — no fallback needed on these routes`;

  return NextResponse.json({
    departureDate: departDate,
    token: `${token.slice(0, 18)}...`,
    summary: {
      totalSearches,
      withOffers,
      zeroOffers,
      apiErrors,
      fallbackTriggeredCount: fallbackCases.length,
    },
    verdict,
    results,
  }, { status: 200 });
}
