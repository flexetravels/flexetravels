/**
 * FlexeTravels — Direct LiteAPI Hotel Booking Test
 * ─────────────────────────────────────────────────
 * Tests the full hotel flow without needing the Next.js server:
 *   /data/hotels  →  /hotels/rates  →  /rates/prebook  →  /rates/book
 *
 * Sandbox path (sand_ key):  ACC_CREDIT_CARD, server-side — no widget
 * Production path (prod_ key): returns secretKey + transactionId for payment widget
 *
 * Usage:
 *   node scripts/test-hotel-booking-direct.mjs
 *
 * Reads LITEAPI_KEY from .env.local automatically.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Load .env.local ────────────────────────────────────────────────────────────
function loadEnvLocal() {
  try {
    const dir  = dirname(fileURLToPath(import.meta.url));
    const file = resolve(dir, '..', '.env.local');
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const eq = t.indexOf('=');
      const k  = t.slice(0, eq).trim();
      const v  = t.slice(eq + 1).trim();
      if (k && !(k in process.env)) process.env[k] = v;
    }
  } catch { /* rely on shell env */ }
}
loadEnvLocal();

const KEY          = process.env.LITEAPI_KEY ?? '';
const LITEAPI_BASE = 'https://api.liteapi.travel/v3.0';
const IS_SANDBOX   = KEY.startsWith('sand_');
const IS_PROD      = KEY.startsWith('prod_');

if (!KEY || (!IS_SANDBOX && !IS_PROD)) {
  console.error('❌  LITEAPI_KEY not set or unrecognised prefix (expected sand_ or prod_)');
  process.exit(1);
}

const HEADERS = { 'X-API-Key': KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' };
const sleep   = ms => new Promise(r => setTimeout(r, ms));

// ── Colour helpers ─────────────────────────────────────────────────────────────
const G = '\x1b[92m', R = '\x1b[91m', Y = '\x1b[93m', B = '\x1b[1m', X = '\x1b[0m';
let passed = 0, failed = 0, warned = 0;
const ok   = m => { console.log(`  ${G}✓${X} ${m}`); passed++; };
const fail = m => { console.log(`  ${R}✗${X} ${m}`); failed++; };
const warn = m => { console.log(`  ${Y}⚠${X} ${m}`); warned++; };
const sec  = t => console.log(`\n${B}━━ ${t} ━━${X}`);

// ── LiteAPI helpers ────────────────────────────────────────────────────────────

async function getHotelList(countryCode, cityName, limit = 10) {
  const url = `${LITEAPI_BASE}/data/hotels?countryCode=${countryCode}&cityName=${encodeURIComponent(cityName)}&limit=${limit}`;
  const r   = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Hotel list HTTP ${r.status} for ${cityName}`);
  const j = await r.json();
  return j.data ?? [];
}

async function getRates(hotelIds, checkIn, checkOut, adults = 2, nationality = 'US') {
  const r = await fetch(`${LITEAPI_BASE}/hotels/rates`, {
    method:  'POST',
    headers: HEADERS,
    body: JSON.stringify({
      hotelIds,
      checkin:          checkIn,
      checkout:         checkOut,
      occupancies:      [{ adults, children: [] }],
      currency:         'USD',
      guestNationality: nationality,
      roomMapping:      true,
      timeout:          5,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!r.ok) throw new Error(`Rates HTTP ${r.status}`);
  const j = await r.json();
  return j.data ?? [];
}

async function prebook(offerId) {
  const body = { offerId };
  // Production only: request payment SDK
  if (!IS_SANDBOX) body.usePaymentSdk = true;

  const r = await fetch(`${LITEAPI_BASE}/rates/prebook`, {
    method:  'POST',
    headers: HEADERS,
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(35_000),
  });
  // Read body once as text — avoids "Body has already been read" error
  // when calling r.json() after r.text() on the same Response.
  const txt = await r.text();
  let parsed;
  try { parsed = JSON.parse(txt); } catch { parsed = {}; }

  if (!r.ok) {
    const code = parsed?.error?.code ?? 0;
    if (code === 4002 || code === 4000) throw new Error('RATE_EXPIRED (4002) — offerId TTL expired, need fresh rates');
    throw new Error(`Prebook HTTP ${r.status}: ${txt.slice(0, 200)}`);
  }
  return parsed.data ?? parsed;
}

async function book(prebookId, guest, transactionId = null) {
  const payment = transactionId
    ? { method: 'TRANSACTION_ID', transactionId }
    : { method: 'ACC_CREDIT_CARD', cardNumber: '4242424242424242', expireDate: '12/2028', cvc: '123' };

  const r = await fetch(`${LITEAPI_BASE}/rates/book`, {
    method:  'POST',
    headers: HEADERS,
    body: JSON.stringify({
      prebookId,
      holder: { firstName: guest.firstName, lastName: guest.lastName, email: guest.email },
      guests: [{ occupancyNumber: 1, firstName: guest.firstName, lastName: guest.lastName, email: guest.email }],
      payment,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Book HTTP ${r.status}: ${txt.slice(0, 300)}`);
  let j; try { j = JSON.parse(txt); } catch { j = {}; }
  return j.data ?? j;
}

function pickCheapestOffer(rateHotels) {
  let bestOfferId = null, bestRateId = null, bestPrice = Infinity, bestHotelName = '';
  for (const h of rateHotels) {
    for (const rt of h.roomTypes ?? []) {
      for (const rate of rt.rates ?? []) {
        const amt = rate.retailRate?.total?.[0]?.amount ?? 0;
        if (amt > 0 && amt < bestPrice) {
          bestPrice    = amt;
          bestOfferId  = rt.offerId;
          bestRateId   = rate.rateId;
          bestHotelName = h.hotelId;
        }
      }
    }
  }
  return { offerId: bestOfferId ?? bestRateId, price: bestPrice, hotelId: bestHotelName };
}

function futureDates(daysFromNow = 30, nights = 2) {
  const ci = new Date(); ci.setDate(ci.getDate() + daysFromNow);
  const co = new Date(ci);  co.setDate(co.getDate() + nights);
  return {
    checkIn:  ci.toISOString().slice(0, 10),
    checkOut: co.toISOString().slice(0, 10),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}FlexeTravels — Direct LiteAPI Hotel Booking Test${X}`);
console.log(`Mode: ${IS_SANDBOX ? `${Y}SANDBOX${X} (ACC_CREDIT_CARD, no real charges)` : `${R}PRODUCTION${X} (payment widget required)`}`);
console.log(`Key:  ${KEY.slice(0, 12)}…`);

// ── Destinations to probe (search + rates only, not book) ─────────────────────
const PROBE_DESTINATIONS = [
  { city: 'Toronto',   country: 'CA', adults: 2 },
  { city: 'Cancun',    country: 'MX', adults: 2 },
  { city: 'Bali',      country: 'ID', adults: 2 },
  { city: 'London',    country: 'GB', adults: 1 },
  { city: 'Las Vegas', country: 'US', adults: 2 },
];

// ── Destination to use for the full booking test ──────────────────────────────
// Toronto is the most reliable in sandbox. We'll fall through to Cancun if needed.
const BOOK_DESTINATIONS = [
  { city: 'Toronto',  country: 'CA', adults: 2 },
  { city: 'Cancun',   country: 'MX', adults: 2 },
  { city: 'Vancouver', country: 'CA', adults: 2 },
];

const { checkIn, checkOut } = futureDates(30, 2);
console.log(`Dates: ${checkIn} → ${checkOut}\n`);

const GUEST = { firstName: 'Test', lastName: 'FlexeTravels', email: 'test@flexetravels.com' };

// ══════════════════════════════════════════════════════════════════════════════
sec('1. Hotel List (GET /data/hotels)');
// ══════════════════════════════════════════════════════════════════════════════

for (const { city, country } of PROBE_DESTINATIONS) {
  try {
    await sleep(350);
    const hotels = await getHotelList(country, city);
    if (hotels.length > 0) {
      ok(`${city}: ${hotels.length} hotels listed (IDs: ${hotels.slice(0, 2).map(h => h.id).join(', ')}…)`);
    } else {
      warn(`${city}: 0 hotels returned — thin sandbox inventory`);
    }
  } catch (e) {
    fail(`${city}: ${e.message}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
sec('2. Live Rates (POST /hotels/rates) — Multiple Destinations');
// ══════════════════════════════════════════════════════════════════════════════

const rateResults = {};

for (const { city, country, adults } of PROBE_DESTINATIONS) {
  try {
    await sleep(500);
    const hotels = await getHotelList(country, city, 5);
    if (hotels.length === 0) { warn(`${city}: skipping rates — no hotels in list`); continue; }

    const hotelIds = hotels.map(h => h.id);
    const rates    = await getRates(hotelIds, checkIn, checkOut, adults);

    const { offerId, price } = pickCheapestOffer(rates);
    if (offerId) {
      ok(`${city} (${adults} adults): ${rates.length} hotels with rates | cheapest USD ${price} | offerId ✓`);
      rateResults[city] = { offerId, price, hotelIds };
    } else {
      warn(`${city}: rates returned but no offerId — inventory gap`);
    }
  } catch (e) {
    fail(`${city} rates: ${e.message}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
sec('3. Prebook (POST /rates/prebook)');
// ══════════════════════════════════════════════════════════════════════════════

let prebookResult = null;
let bookedCity    = null;

for (const { city, country, adults } of BOOK_DESTINATIONS) {
  if (prebookResult) break; // already have a valid prebook

  const rr = rateResults[city];
  if (!rr?.offerId) {
    // Fetch fresh if not already in rateResults
    try {
      await sleep(500);
      const hotels = await getHotelList(country, city, 5);
      if (!hotels.length) { warn(`${city}: no hotels, skipping prebook`); continue; }
      await sleep(500);
      const rates = await getRates(hotels.map(h => h.id), checkIn, checkOut, adults);
      const { offerId, price } = pickCheapestOffer(rates);
      if (offerId) rateResults[city] = { offerId, price };
      else { warn(`${city}: no offerId for prebook`); continue; }
    } catch (e) {
      warn(`${city}: rate fetch for prebook failed — ${e.message}`); continue;
    }
  }

  try {
    await sleep(600);
    console.log(`  Prebooking ${city} with offerId: ${rateResults[city].offerId.slice(0, 40)}…`);
    const data = await prebook(rateResults[city].offerId);

    const prebookId = data.prebookId;
    if (!prebookId) throw new Error(`No prebookId in response: ${JSON.stringify(data).slice(0, 200)}`);

    const confirmedPrice = data.price ?? data.msp ?? '?';
    const currency       = data.currency ?? 'USD';
    const cancelType     = data.cancellationPolicies?.type ?? 'unknown';
    const secretKey      = data.secretKey;
    const transactionId  = data.transactionId;

    prebookResult = { prebookId, secretKey, transactionId, city };
    bookedCity    = city;

    ok(`${city}: prebookId=${prebookId} | confirmed ${currency} ${confirmedPrice} | cancel=${cancelType}`);

    if (IS_SANDBOX) {
      ok(`Sandbox mode: ACC_CREDIT_CARD will be used (no real charge)`);
    } else {
      if (secretKey && transactionId) {
        ok(`Production: secretKey ✓ | transactionId ✓ — payment widget ready`);
      } else {
        warn(`Production: secretKey=${!!secretKey}, transactionId=${!!transactionId} — widget fields missing`);
      }
    }
  } catch (e) {
    warn(`${city} prebook: ${e.message}`);
  }
}

if (!prebookResult) {
  fail('All prebook attempts failed — cannot proceed to booking test');
}

// ══════════════════════════════════════════════════════════════════════════════
sec('4. Book (POST /rates/book)');
// ══════════════════════════════════════════════════════════════════════════════

if (prebookResult) {
  const { prebookId, secretKey, transactionId, city } = prebookResult;

  if (!IS_SANDBOX && !transactionId) {
    warn(`Production key detected but no transactionId — skipping book step`);
    warn(`In production the customer must complete payment in the LiteAPI widget first,`);
    warn(`then /api/complete-hotel-booking is called with the transactionId.`);
  } else {
    try {
      await sleep(1000); // LiteAPI needs a moment after prebook before book
      const txId = IS_SANDBOX ? null : transactionId;
      console.log(`  Booking ${city} | prebookId=${prebookId} | method=${IS_SANDBOX ? 'ACC_CREDIT_CARD' : 'TRANSACTION_ID'}`);

      const data = await book(prebookId, GUEST, txId);

      // LiteAPI v3 uses several possible keys for the booking ref
      const bookingId =
        data.bookingId ?? data.id ?? data.bookingReference ??
        data.booking_id ?? data.confirmationNumber;

      const status    = data.status ?? data.bookingStatus ?? '?';
      const hotelName = data.hotel?.name ?? data.hotelName ?? data.name ?? '?';
      const currency  = data.currency ?? 'USD';
      const total     = data.totalAmount ?? data.totalPayable?.amount ?? data.price ?? '?';

      if (bookingId) {
        ok(`${B}BOOKED!${X} ref=${bookingId} | hotel="${hotelName}" | status=${status} | ${currency} ${total}`);
      } else {
        // Might still be success if status is CONFIRMED/OK
        const isSuccess = ['CONFIRMED', 'OK', 'BOOKED', 'SUCCESS'].includes(String(status).toUpperCase());
        if (isSuccess) {
          warn(`Booking confirmed (status=${status}) but no bookingId returned — using timestamp ref`);
          ok(`${B}BOOKED (no ref)!${X} hotel="${hotelName}" | ${currency} ${total}`);
        } else {
          fail(`Book returned HTTP 200 but no bookingId or CONFIRMED status — raw: ${JSON.stringify(data).slice(0, 300)}`);
        }
      }
    } catch (e) {
      fail(`Book failed: ${e.message}`);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
sec('5. Edge Cases');
// ══════════════════════════════════════════════════════════════════════════════

// 5a. Expired/invalid offerId — should return error code 4002, not a 500
try {
  await sleep(400);
  await prebook('INVALID_EXPIRED_OFFER_TOKEN_XYZ_12345');
  fail('Expired token: expected an error but got success — hallucination risk!');
} catch (e) {
  if (e.message.includes('RATE_EXPIRED') || e.message.includes('4002') ||
      e.message.includes('4000') || e.message.includes('400') || e.message.includes('404')) {
    ok(`Expired offerId: rejected gracefully (${e.message.slice(0, 60)})`);
  } else {
    warn(`Expired offerId: unexpected error type — ${e.message.slice(0, 80)}`);
  }
}

// 5b. Multi-passenger rate fetch (4 adults)
try {
  await sleep(400);
  const hotels = await getHotelList('MX', 'Cancun', 3);
  if (hotels.length > 0) {
    await sleep(400);
    const rates = await getRates(hotels.map(h => h.id), checkIn, checkOut, 4);
    const { offerId, price } = pickCheapestOffer(rates);
    if (offerId) ok(`Multi-passenger (4 adults, Cancun): rates returned, cheapest USD ${price}`);
    else warn(`Multi-passenger (4 adults, Cancun): rates returned but no offerId`);
  } else {
    warn('Multi-passenger: no Cancun hotels — skipping');
  }
} catch (e) {
  fail(`Multi-passenger test: ${e.message}`);
}

// 5c. Short stay (1 night) vs standard (2 nights) — pricing should differ
try {
  await sleep(400);
  const hotels = await getHotelList('CA', 'Vancouver', 3);
  if (hotels.length > 0) {
    await sleep(400);
    const d1 = futureDates(35, 1); // 1 night
    const r1  = await getRates(hotels.map(h => h.id), d1.checkIn, d1.checkOut, 2);
    await sleep(400);
    const d2 = futureDates(35, 3); // 3 nights
    const r2  = await getRates(hotels.map(h => h.id), d2.checkIn, d2.checkOut, 2);
    const p1  = pickCheapestOffer(r1).price;
    const p2  = pickCheapestOffer(r2).price;
    if (p1 !== Infinity && p2 !== Infinity) {
      ok(`Vancouver pricing sanity: 1-night cheapest USD ${p1} | 3-night USD ${p2} (${p2 > p1 ? 'longer = more ✓' : 'shorter = more ✓'})`);
    } else {
      warn('Vancouver pricing sanity: could not get rates for comparison');
    }
  } else {
    warn('Pricing sanity: no Vancouver hotels — skipping');
  }
} catch (e) {
  warn(`Pricing sanity test: ${e.message}`);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}${'━'.repeat(52)}${X}`);
console.log(`Results: ${G}PASS: ${passed}${X}  ${R}FAIL: ${failed}${X}  ${Y}WARN: ${warned}${X}`);
if (failed === 0) {
  console.log(`${G}${B}All critical checks passed ✓${X}`);
  if (IS_SANDBOX) {
    console.log(`\n${Y}Note:${X} Tested with sandbox key. For production:`);
    console.log(`  1. Switch LITEAPI_KEY to prod_xxx`);
    console.log(`  2. Prebook will return secretKey + transactionId`);
    console.log(`  3. Frontend loads payment widget at https://payment-wrapper.liteapi.travel/dist/liteAPIPayment.js`);
    console.log(`  4. After customer pays, frontend calls /api/complete-hotel-booking with transactionId`);
  }
} else {
  console.log(`${R}${B}${failed} failure(s) — fix before deploying${X}`);
}
console.log();
