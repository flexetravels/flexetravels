import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

const userSessions = { upsert: vi.fn(async () => undefined) };
const searchLogs = { create: vi.fn(async () => ({ id: 'log_123' })) };

vi.mock('@/lib/db/client', () => ({
  DB_AVAILABLE: true,
  db: {
    userSessions,
    searchLogs,
  },
}));

vi.mock('@/lib/search/aggregator', () => ({
  NA_AIRPORTS: {
    vancouver: 'YVR',
    'san francisco': 'SFO',
  },
  aggregateFlights: vi.fn(async () => ({
    flights: [{ id: 'off_test', price: 500, currency: 'USD' }],
    sources: ['duffel'],
    errors: [],
    latencyMs: 321,
  })),
  aggregateHotels: vi.fn(async () => ({
    hotels: [{ id: 'hotel_test', name: 'Test Hotel' }],
    sources: ['liteapi'],
    errors: [],
    latencyMs: 654,
    isSample: false,
  })),
}));

afterEach(() => {
  userSessions.upsert.mockClear();
  searchLogs.create.mockClear();
  process.env = { ...originalEnv };
});

describe('direct search persistence', () => {
  it('persists homepage flight search session and search log', async () => {
    const { POST } = await import('@/app/api/search/flights/route');

    const res = await POST(new Request('http://localhost/api/search/flights', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
      body: JSON.stringify({
        sessionId: 'session_flight_123',
        origin: 'YVR',
        destination: 'SFO',
        departureDate: '2026-06-19',
        tripType: 'one_way',
        adults: 1,
        childrenAges: [5],
        cabinClass: 'premium_economy',
        maxConnections: 1,
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sessionId).toBe('session_flight_123');
    expect(userSessions.upsert).toHaveBeenCalledWith('session_flight_123', 'vitest');
    expect(searchLogs.create).toHaveBeenCalledWith(expect.objectContaining({
      session_id: 'session_flight_123',
      search_type: 'flight',
      origin: 'YVR',
      destination: 'SFO',
      depart_date: '2026-06-19',
      adults: 1,
      children: 1,
      cabin_class: 'premium_economy',
      result_count: 1,
      provider_sources: ['duffel'],
      safe_error_category: null,
      converted: false,
    }));
  });

  it('persists homepage hotel search session and search log', async () => {
    const { POST } = await import('@/app/api/search/hotels/route');

    const res = await POST(new Request('http://localhost/api/search/hotels', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
      body: JSON.stringify({
        sessionId: 'session_hotel_123',
        destination: 'Vancouver',
        checkIn: '2026-06-19',
        checkOut: '2026-06-22',
        adults: 2,
        childrenAges: [],
        stars: 4,
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sessionId).toBe('session_hotel_123');
    expect(userSessions.upsert).toHaveBeenCalledWith('session_hotel_123', 'vitest');
    expect(searchLogs.create).toHaveBeenCalledWith(expect.objectContaining({
      session_id: 'session_hotel_123',
      search_type: 'hotel',
      destination: 'Vancouver',
      depart_date: '2026-06-19',
      return_date: '2026-06-22',
      adults: 2,
      children: 0,
      result_count: 1,
      provider_sources: ['liteapi'],
      safe_error_category: null,
      converted: false,
    }));
  });
});
