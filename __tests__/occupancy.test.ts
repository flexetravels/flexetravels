/**
 * __tests__/occupancy.test.ts
 *
 * Tests for multi-room occupancy distribution logic and guest room assignment.
 *
 * Critical invariants:
 *  1. buildOccupancies: no room ever has more than 2 adults
 *  2. buildOccupancies: total adults across all rooms equals input adults
 *  3. buildOccupancies: rooms = ceil(adults / 2)
 *  4. guestOccupancyNumber: assignment follows 2-guests-per-room (1-based)
 *  5. occupancyNumbers must not exceed the number of rooms
 */

import { describe, it, expect } from 'vitest';

// ── Replicate the pure logic from lib/search/liteapi.ts ──────────────────────
// These are pure functions — no external deps needed.

function buildOccupancies(adults: number): Array<{ adults: number; children: never[] }> {
  const n     = Math.max(1, adults);
  const rooms = Math.ceil(n / 2);
  return Array.from({ length: rooms }, (_, i) => {
    const isLast     = i === rooms - 1;
    const roomAdults = isLast && n % 2 === 1 ? 1 : 2;
    return { adults: roomAdults, children: [] as never[] };
  });
}

/** Returns occupancyNumber (1-based room index) for the Nth guest (0-indexed). */
function guestOccupancyNumber(guestIndex: number): number {
  return Math.floor(guestIndex / 2) + 1;
}

// ── buildOccupancies ─────────────────────────────────────────────────────────

describe('buildOccupancies', () => {
  it('1 adult → 1 room with 1 adult', () => {
    const occ = buildOccupancies(1);
    expect(occ).toHaveLength(1);
    expect(occ[0].adults).toBe(1);
  });

  it('2 adults → 1 room with 2 adults', () => {
    const occ = buildOccupancies(2);
    expect(occ).toHaveLength(1);
    expect(occ[0].adults).toBe(2);
  });

  it('3 adults → 2 rooms (2 + 1)', () => {
    const occ = buildOccupancies(3);
    expect(occ).toHaveLength(2);
    expect(occ[0].adults).toBe(2);
    expect(occ[1].adults).toBe(1);
  });

  it('4 adults → 2 rooms (2 + 2)', () => {
    const occ = buildOccupancies(4);
    expect(occ).toHaveLength(2);
    expect(occ[0].adults).toBe(2);
    expect(occ[1].adults).toBe(2);
  });

  it('5 adults → 3 rooms (2 + 2 + 1)', () => {
    const occ = buildOccupancies(5);
    expect(occ).toHaveLength(3);
    expect(occ[0].adults).toBe(2);
    expect(occ[1].adults).toBe(2);
    expect(occ[2].adults).toBe(1);
  });

  it('6 adults → 3 rooms (2 + 2 + 2)', () => {
    const occ = buildOccupancies(6);
    expect(occ).toHaveLength(3);
    expect(occ.every(r => r.adults === 2)).toBe(true);
  });

  it('edge case: 0 adults → treated as 1 adult', () => {
    const occ = buildOccupancies(0);
    expect(occ).toHaveLength(1);
    expect(occ[0].adults).toBeGreaterThanOrEqual(1);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'invariant: no room ever exceeds 2 adults (adults=%i)',
    (adults) => {
      const occ = buildOccupancies(adults);
      occ.forEach(room => {
        expect(room.adults).toBeLessThanOrEqual(2);
        expect(room.adults).toBeGreaterThanOrEqual(1);
      });
    },
  );

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'invariant: total adults across rooms equals input (adults=%i)',
    (adults) => {
      const occ = buildOccupancies(adults);
      const total = occ.reduce((sum, r) => sum + r.adults, 0);
      expect(total).toBe(adults);
    },
  );

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'invariant: room count = ceil(adults/2) (adults=%i)',
    (adults) => {
      const occ = buildOccupancies(adults);
      expect(occ).toHaveLength(Math.ceil(adults / 2));
    },
  );

  it('all rooms always have empty children array', () => {
    const occ = buildOccupancies(4);
    occ.forEach(room => {
      expect(Array.isArray(room.children)).toBe(true);
      expect(room.children).toHaveLength(0);
    });
  });
});

// ── Guest → room assignment ───────────────────────────────────────────────────

describe('guestOccupancyNumber', () => {
  it('lead guest (index 0) → room 1', () => {
    expect(guestOccupancyNumber(0)).toBe(1);
  });

  it('2nd guest (index 1) → room 1 (same room as lead)', () => {
    expect(guestOccupancyNumber(1)).toBe(1);
  });

  it('3rd guest (index 2) → room 2', () => {
    expect(guestOccupancyNumber(2)).toBe(2);
  });

  it('4th guest (index 3) → room 2', () => {
    expect(guestOccupancyNumber(3)).toBe(2);
  });

  it('5th guest (index 4) → room 3', () => {
    expect(guestOccupancyNumber(4)).toBe(3);
  });

  it('6th guest (index 5) → room 3', () => {
    expect(guestOccupancyNumber(5)).toBe(3);
  });
});

describe('guest assignment × buildOccupancies consistency', () => {
  /**
   * For any party size N, every guest's occupancyNumber must be ≤ rooms needed.
   * Guests fill rooms in order: [room1-guest1, room1-guest2, room2-guest1, ...]
   */
  it.each([1, 2, 3, 4, 5, 6])(
    'all occupancyNumbers ≤ roomCount for %i adults',
    (adults) => {
      const occ = buildOccupancies(adults);
      const roomCount = occ.length;
      for (let i = 0; i < adults; i++) {
        const room = guestOccupancyNumber(i);
        expect(room).toBeLessThanOrEqual(roomCount);
        expect(room).toBeGreaterThanOrEqual(1);
      }
    },
  );

  it('2 adults: both in room 1 (no error 4002)', () => {
    const adults = 2;
    const occ = buildOccupancies(adults);
    expect(occ).toHaveLength(1);
    // Both guests must reference occupancy 1 (the only room)
    for (let i = 0; i < adults; i++) {
      expect(guestOccupancyNumber(i)).toBe(1);
    }
  });

  it('3 adults: 2 in room 1, 1 in room 2', () => {
    const rooms = buildOccupancies(3);
    expect(rooms).toHaveLength(2);
    expect(guestOccupancyNumber(0)).toBe(1);
    expect(guestOccupancyNumber(1)).toBe(1);
    expect(guestOccupancyNumber(2)).toBe(2);
  });

  it('4 adults: 2 in each of 2 rooms', () => {
    const rooms = buildOccupancies(4);
    expect(rooms).toHaveLength(2);
    expect(guestOccupancyNumber(0)).toBe(1);
    expect(guestOccupancyNumber(1)).toBe(1);
    expect(guestOccupancyNumber(2)).toBe(2);
    expect(guestOccupancyNumber(3)).toBe(2);
  });
});
