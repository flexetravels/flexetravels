#!/usr/bin/env node
/**
 * End-to-end hotel booking test
 * Run: node scripts/test-hotel-booking.mjs
 * Requires local dev server: npm run dev
 */

const BASE = 'http://localhost:3000';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

// ─── 1. Health check ──────────────────────────────────────────────────────────
console.log('\n[1] Health check...');
const health = await get('/api/health');
console.log('   DB:', health.db ? '✅ connected' : '❌ not connected', '|', health.reason ?? health.trips_ping ?? '');
if (!health.db) { console.error('   Stopping — DB not available'); process.exit(1); }

// ─── 2. Search for hotels (Toronto, April) ────────────────────────────────────
console.log('\n[2] Searching for hotels via /api/chat (tool call)...');
const searchRes = await post('/api/chat', {
  sessionId: 'test-session-' + Date.now(),
  messages: [{
    role: 'user',
    content: 'Search for hotels in Toronto for April 10-12 2026, 2 adults. Just show me the hotel results.'
  }]
});

if (!searchRes.ok) {
  console.error('   Chat search failed:', searchRes.status, JSON.stringify(searchRes.data).slice(0, 200));
  process.exit(1);
}

// Extract hotel from the response
const chatText = JSON.stringify(searchRes.data);
const hotelMatch = chatText.match(/"id":"([^"]+)","name":"([^"]+)"[^}]*"checkIn":"(\d{4}-\d{2}-\d{2})","checkOut":"(\d{4}-\d{2}-\d{2})"/);
const tokenMatch = chatText.match(/"bookingToken":"liteapi_([^"]+)"/);

if (!hotelMatch || !tokenMatch) {
  console.log('   Could not extract hotel from chat response — trying direct rates endpoint...');

  // ─── 3. Direct hotel rates test ────────────────────────────────────────────
  console.log('\n[3] Direct test: POST /api/book-trip with known hotel metadata...');
  const bookRes = await post('/api/book-trip', {
    sessionId:    'test-' + Date.now(),
    hotelRateId:  'liteapi_placeholder',          // stale cached token
    hotelId:      'lp24373',                      // real LiteAPI Toronto hotel ID
    hotelCheckIn: '2026-04-10',
    hotelCheckOut:'2026-04-12',
    hotelName:    'Test Hotel Toronto',
    passengers: [{
      firstName:   'Test',
      lastName:    'User',
      dateOfBirth: '1990-01-01',
      email:       'test@flexetravels.com',
      phone:       '4161234567',
    }],
    childPassengers: [],
    originAirport:   'YYZ',
    guestNationality:'CA',
  });

  console.log('   Status:', bookRes.status);
  console.log('   Response:', JSON.stringify(bookRes.data, null, 2).slice(0, 500));

  if (bookRes.data?.error?.includes('HOTEL_RATE_EXPIRED') || bookRes.data?.flightError?.includes('HOTEL_RATE_EXPIRED')) {
    console.log('\n   ❌ Still getting HOTEL_RATE_EXPIRED — fresh rate fetch may have failed');
    console.log('   Check server logs for: [liteApiGetFreshOfferId]');
  } else if (bookRes.data?.error?.includes('Prebook failed 400')) {
    console.log('\n   ❌ Still getting raw 4002 — error handler not triggering');
  } else {
    console.log('\n   ✅ No 4002 error — fresh rate fetch is working (or no hotel results for that ID)');
  }
  process.exit(0);
}

const [, hotelId, hotelName, checkIn, checkOut] = hotelMatch;
const bookingToken = `liteapi_${tokenMatch[1]}`;

console.log(`   Found: "${hotelName}" (${hotelId}), ${checkIn}→${checkOut}`);
console.log(`   Cached token: ${bookingToken.slice(0, 40)}…`);

// ─── 4. Book with fresh rate fetch ────────────────────────────────────────────
console.log('\n[4] Booking with hotelId + dates (triggers fresh offerId fetch)...');
const bookRes = await post('/api/book-trip', {
  sessionId:     'test-' + Date.now(),
  hotelRateId:   bookingToken,
  hotelId,
  hotelCheckIn:  checkIn,
  hotelCheckOut: checkOut,
  hotelName,
  passengers: [{
    firstName:   'Test',
    lastName:    'User',
    dateOfBirth: '1990-01-01',
    email:       'test@flexetravels.com',
    phone:       '4161234567',
  }],
  childPassengers:  [],
  originAirport:    'YYZ',
  guestNationality: 'CA',
});

console.log('   Status:', bookRes.status);

if (bookRes.data?.error?.includes('HOTEL_RATE_EXPIRED')) {
  console.log('\n   ❌ HOTEL_RATE_EXPIRED — fresh rate fetch failed or returned no offerId');
  console.log('   Check server logs for: [liteApiGetFreshOfferId]');
} else if (bookRes.data?.error?.includes('Prebook failed')) {
  console.log('\n   ❌ Prebook failed (not rate expiry):', bookRes.data.error);
} else if (bookRes.data?.success || bookRes.data?.flightRef || bookRes.data?.hotelRef) {
  console.log('\n   ✅ Booking succeeded!');
  console.log('   Flight ref:', bookRes.data?.flightRef ?? 'n/a');
  console.log('   Hotel ref: ', bookRes.data?.hotelRef  ?? 'n/a');
} else {
  console.log('   Response:', JSON.stringify(bookRes.data, null, 2).slice(0, 600));
}
