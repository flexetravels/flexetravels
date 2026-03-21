// ─── LiteAPI Debug Endpoint ────────────────────────────────────────────────────
// GET /api/debug/liteapi?dest=Cancun&checkIn=2026-04-10&checkOut=2026-04-15
// Tests hotel list + rates for a destination and returns raw counts + raw response.
// REMOVE or gate behind auth before going live.

import { NextResponse } from 'next/server';
import { resolveCityCountry } from '@/lib/search/liteapi';

const LITEAPI_BASE = 'https://api.liteapi.travel/v3.0';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dest     = searchParams.get('dest')    ?? 'Cancun';
  const checkIn  = searchParams.get('checkIn') ?? (() => {
    const d = new Date(); d.setDate(d.getDate() + 14);
    return d.toISOString().split('T')[0];
  })();
  const checkOut = searchParams.get('checkOut') ?? (() => {
    const d = new Date(); d.setDate(d.getDate() + 17);
    return d.toISOString().split('T')[0];
  })();

  const apiKey = process.env.LITEAPI_KEY;
  if (!apiKey) return NextResponse.json({ error: 'LITEAPI_KEY not set' }, { status: 503 });

  const headers = {
    'X-API-Key':    apiKey,
    'Content-Type': 'application/json',
    Accept:         'application/json',
  };

  const { city, countryCode } = resolveCityCountry(dest);

  // Step 1: hotel list
  const listUrl = `${LITEAPI_BASE}/data/hotels?countryCode=${countryCode}&cityName=${encodeURIComponent(city)}&limit=10`;
  let hotelCount = 0;
  let hotelIds: string[] = [];
  let listError: string | null = null;
  let listHttpStatus: number | null = null;

  try {
    const r = await fetch(listUrl, { headers, signal: AbortSignal.timeout(15_000) });
    listHttpStatus = r.status;
    const body = await r.json() as { data?: Array<{ id: string; name: string }> };
    hotelIds   = (body.data ?? []).map(h => h.id);
    hotelCount = hotelIds.length;
  } catch (e) {
    listError = String(e);
  }

  // Step 2: rates
  let ratesWithPrices = 0;
  let ratesError: string | null = null;
  let ratesHttpStatus: number | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawRatesBody: any = null;
  let sampleRates: Array<{ hotelId: string; cheapestUSD: number; rateId: string }> = [];

  const ratesRequestBody = {
    hotelIds,
    checkin:          checkIn,
    checkout:         checkOut,
    occupancies:      [{ adults: 2, children: [] as number[] }],
    currency:         'USD',
    guestNationality: 'US',
  };

  if (hotelIds.length > 0) {
    try {
      const r = await fetch(`${LITEAPI_BASE}/hotels/rates`, {
        method: 'POST',
        headers,
        body: JSON.stringify(ratesRequestBody),
        signal: AbortSignal.timeout(35_000),
      });
      ratesHttpStatus = r.status;
      const body = await r.json();
      rawRatesBody = body;

      const typedBody = body as {
        data?: Array<{
          hotelId: string;
          roomTypes?: Array<{ rates?: Array<{ rateId?: string; retailRate?: { total?: Array<{ amount: number; currency: string }> } }> }>;
        }>;
      };
      for (const h of typedBody.data ?? []) {
        const allRates = (h.roomTypes ?? []).flatMap(rt => rt.rates ?? []);
        const withPrice = allRates.filter(rt => (rt.retailRate?.total?.[0]?.amount ?? 0) > 0);
        if (withPrice.length > 0) {
          ratesWithPrices++;
          const cheapest = withPrice.reduce((best, rr) =>
            (rr.retailRate?.total?.[0]?.amount ?? 0) < (best.retailRate?.total?.[0]?.amount ?? Infinity) ? rr : best
          );
          sampleRates.push({
            hotelId:     h.hotelId,
            cheapestUSD: cheapest.retailRate?.total?.[0]?.amount ?? 0,
            rateId:      cheapest.rateId ?? '',
          });
          if (sampleRates.length >= 3) break;
        }
      }
    } catch (e) {
      ratesError = String(e);
    }
  }

  // Show first hotel raw data for diagnosis (truncated to avoid huge response)
  const rawRatesPreview = Array.isArray(rawRatesBody?.data)
    ? {
        totalHotelsInResponse: rawRatesBody.data.length,
        firstHotel: rawRatesBody.data[0] ?? null,
        topLevelKeys: Object.keys(rawRatesBody),
      }
    : rawRatesBody;

  return NextResponse.json({
    destination: { input: dest, resolved: { city, countryCode } },
    dates:       { checkIn, checkOut },
    step1_hotels:  { count: hotelCount, hotelIdsSample: hotelIds.slice(0, 3), httpStatus: listHttpStatus, error: listError },
    step2_rates:   {
      hotelsWithRates: ratesWithPrices,
      httpStatus: ratesHttpStatus,
      error: ratesError,
      requestSent: ratesRequestBody,
      rawResponsePreview: rawRatesPreview,
    },
    bookable:      ratesWithPrices > 0,
    sampleRates:   sampleRates.slice(0, 3),
    verdict: ratesWithPrices > 0
      ? `✅ ${ratesWithPrices} bookable hotel(s) found in LiteAPI for ${city} (${checkIn} → ${checkOut})`
      : hotelCount > 0
        ? `⚠️ Hotels found (${hotelCount}) but no rates for ${checkIn} → ${checkOut}. Check rawResponsePreview for details.`
        : `❌ No hotels found for ${city} (${countryCode}) in LiteAPI sandbox.`,
  });
}
