import { expect, test } from '@playwright/test';

// ─── End-to-end flow ────────────────────────────────────────────────────────
// Walks a real user journey through the canvas: create canvas, set vibes +
// home airport, add two legs, verify the route map updates correctly across
// reorder + remove (catches the stale-marker bug), open the hotel picker,
// exercise every filter chip, drill into hotel detail and verify photos.
//
// Captures a screenshot at each significant step into e2e/.results/flow-*.png
// so we have a visual paper trail of what each piece looks like in the
// browser. Failure or success, the screenshots stay.
//
// All search calls are routed through Playwright's network mocking so we can
// (a) run without live Duffel/LiteAPI credentials and (b) inspect the
// requests our UI generated to make sure the right params went out.

const HOTEL_FIXTURES = [
  {
    id: 'h1', provider: 'liteapi', name: 'Le Grand Hôtel Marais',
    location: 'Le Marais, Paris', city: 'Paris',
    stars: 5, rating: 9.2, reviewCount: 1840,
    pricePerNight: 480, totalPrice: 1920, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1551918120-9739cb430c6d?w=800&q=80',
    rateId: 'r1', bookingToken: 'tok1',
    boardType: 'BB', boardName: 'Bed & Breakfast',
    refundableTag: 'RFN',
    cancellation: 'Free cancellation until 48h before',
    maxOccupancy: 2,
    cancelPolicies: [
      { cancelTime: '2026-06-08T00:00:00Z', amount: 0, description: 'Free cancellation' },
      { cancelTime: '2026-06-10T00:00:00Z', amount: 480, description: 'One night charge' },
    ],
    taxesAndFees: [
      { description: 'City tax',         amount: 18.50, included: true },
      { description: 'VAT',              amount: 96.00, included: true },
    ],
  },
  {
    id: 'h2', provider: 'liteapi', name: 'Hostel Bohème Paris',
    location: '11ème arrondissement', city: 'Paris',
    stars: 2, rating: 7.8, reviewCount: 612,
    pricePerNight: 88, totalPrice: 352, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&q=80',
    rateId: 'r2', bookingToken: 'tok2',
    boardType: 'RO', boardName: 'Room only',
    refundableTag: 'NRFN',
    cancellation: 'Non-refundable',
  },
  {
    id: 'h3', provider: 'liteapi', name: 'Pullman Paris Tour Eiffel',
    location: '15ème arrondissement', city: 'Paris',
    stars: 4, rating: 8.6, reviewCount: 3120,
    pricePerNight: 245, totalPrice: 980, currency: 'USD',
    image: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&q=80',
    rateId: 'r3', bookingToken: 'tok3',
    boardType: 'AI', boardName: 'All-Inclusive',
    refundableTag: 'NRFN',
    cancellation: 'Non-refundable',
  },
];

const FLIGHT_FIXTURES = [
  {
    id: 'f1', airline: 'Air France', origin: 'YVR', destination: 'CDG',
    departure: '2026-06-08T22:00:00Z', arrival: '2026-06-09T16:30:00Z',
    duration: '9h 30m', stops: 0, price: 720, currency: 'USD', cabinClass: 'economy',
    legs: [{ origin: 'YVR', destination: 'CDG', segments: [{ flightNumber: 'AF361', carrier: 'AF' }] }],
    fareVariants: [{ flexibilityLabel: 'Moderate' }],
  },
];

const HOTEL_DETAIL = {
  id: 'h1', name: 'Le Grand Hôtel Marais', starRating: 5,
  description: '<p>Boutique 5-star in the heart of Le Marais. Walking distance to the Louvre, Notre-Dame, and the Place des Vosges. Rooftop bar, indoor pool, and Michelin-trained restaurant on site.</p>',
  images: [
    { url: 'https://images.unsplash.com/photo-1551918120-9739cb430c6d?w=1200&q=80', isDefault: true },
    { url: 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=1200&q=80' },
    { url: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=1200&q=80' },
  ],
  amenities: ['Free WiFi', 'Indoor swimming pool', 'Restaurant', 'Fitness centre', 'Air conditioning', 'Concierge service', 'Breakfast available', 'Bar / Lounge'],
  checkinTime: '15:00', checkoutTime: '12:00',
  address: '7 Rue de Sévigné, 75004 Paris',
  city: 'Paris', countryCode: 'FR',
  coordinates: { lat: 48.8546, lon: 2.3622 },
  contact: { phone: '+33 1 42 78 47 39', website: 'https://example.com' },
};

async function dbAvailable(request: import('@playwright/test').APIRequestContext): Promise<boolean> {
  try {
    const json = await request.get('/api/health').then(r => r.json());
    return !!json?.db;
  } catch { return false; }
}

test.describe('Destination images update dynamically', () => {
  test.setTimeout(120_000);

  test('changing the leg city refreshes the hero photo', async ({ page, request }) => {
    async function dbAvailable(): Promise<boolean> {
      try {
        const json = await request.get('/api/health').then(r => r.json());
        return !!json?.db;
      } catch { return false; }
    }
    test.skip(!(await dbAvailable()), 'DB unavailable');

    // Mock /api/canvas/photos so we control exactly which hero each city gets
    const heroes: Record<string, { hero: string; gallery: string[] }> = {
      Paris:   { hero: 'https://upload.wikimedia.org/wikipedia/commons/eiffel.jpg',     gallery: ['https://images.unsplash.com/photo-paris-1?w=800'] },
      Tokyo:   { hero: 'https://upload.wikimedia.org/wikipedia/commons/skytree.jpg',    gallery: ['https://images.unsplash.com/photo-tokyo-1?w=800'] },
      Reykjavik:{ hero: 'https://upload.wikimedia.org/wikipedia/commons/hallgrim.jpg', gallery: ['https://images.unsplash.com/photo-iceland-1?w=800'] },
    };
    await page.route('**/api/canvas/photos**', async (route) => {
      const url = new URL(route.request().url());
      const city = url.searchParams.get('city') ?? '';
      const match = heroes[city];
      if (!match) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'no hero' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(match) });
    });

    await page.goto('/trip');
    await page.waitForURL(/\/trip\/[0-9a-f-]{36}/, { timeout: 30_000 });

    // Dismiss vibe sheet if it appears
    const vibe = page.getByRole('heading', { name: /What's your vibe/i });
    try {
      await vibe.waitFor({ state: 'visible', timeout: 4000 });
      await page.getByRole('button', { name: /Skip for now/i }).click();
      await vibe.waitFor({ state: 'hidden' });
    } catch { /* not shown */ }

    // ── First leg: Paris ────────────────────────────────────────────────────
    await page.getByRole('button', { name: /Add your first stop/i }).click();
    await page.getByLabel(/City or destination/i).fill('Paris');
    await page.getByRole('button', { name: /Add to trip/i }).click();
    await expect(page.getByRole('heading', { name: 'Paris' })).toBeVisible();

    await expect.poll(async () => {
      const el = page.locator('[role="img"][aria-label="Paris"]').first();
      return (await el.getAttribute('style')) ?? '';
    }, { timeout: 10_000 }).toMatch(/eiffel\.jpg/);

    // ── Remove Paris, add Tokyo — hero should be the Tokyo URL, not Eiffel ─
    await page.locator('article').filter({ has: page.getByRole('heading', { name: 'Paris' }) })
      .getByRole('button', { name: /Remove leg/i }).click();
    await expect(page.getByRole('heading', { name: 'Paris' })).toHaveCount(0);

    await page.getByRole('button', { name: /Add your first stop/i }).click();
    await page.getByLabel(/City or destination/i).fill('Tokyo');
    await page.getByRole('button', { name: /Add to trip/i }).click();
    await expect(page.getByRole('heading', { name: 'Tokyo' })).toBeVisible();

    await expect.poll(async () => {
      const el = page.locator('[role="img"][aria-label="Tokyo"]').first();
      return (await el.getAttribute('style')) ?? '';
    }, { timeout: 10_000 }).toMatch(/skytree\.jpg/);

    // ── Add a second leg: Reykjavik. Tokyo should keep its hero, Reykjavik
    //    should get its own — i.e. each leg's hero is independent. ─────────
    await page.getByRole('button', { name: /add another chapter/i }).click();
    await page.getByLabel(/City or destination/i).fill('Reykjavik');
    await page.getByRole('button', { name: /Add to trip/i }).click();
    await expect(page.getByRole('heading', { name: 'Reykjavik' })).toBeVisible();

    await expect.poll(async () => {
      const el = page.locator('[role="img"][aria-label="Reykjavik"]').first();
      return (await el.getAttribute('style')) ?? '';
    }, { timeout: 10_000 }).toMatch(/hallgrim\.jpg/);

    const tokyoStyle = await page.locator('[role="img"][aria-label="Tokyo"]').first().getAttribute('style') ?? '';
    expect(tokyoStyle).toMatch(/skytree\.jpg/);
  });
});

test.describe('Cart round-trip preserves the canvas', () => {
  test.setTimeout(120_000);

  test('checkout → /booking → Back link returns to the same trip canvas', async ({ page, request }) => {
    async function dbAvailable(): Promise<boolean> {
      try {
        const json = await request.get('/api/health').then(r => r.json());
        return !!json?.db;
      } catch { return false; }
    }
    test.skip(!(await dbAvailable()), 'DB unavailable');

    // Stub out search so we can pick a flight + hotel quickly without live APIs
    await page.route('**/api/search/flights', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          flights: [{
            id: 'tr-f1', airline: 'Air Test', origin: 'YVR', destination: 'CDG',
            departure: '2026-06-08T22:00:00Z', arrival: '2026-06-09T16:30:00Z',
            duration: '9h 30m', stops: 0, price: 600, currency: 'USD', cabinClass: 'economy',
            legs: [{ origin: 'YVR', destination: 'CDG', segments: [{ flightNumber: 'XX1', carrier: 'XX' }] }],
          }],
          sources: ['duffel'], errors: [], latencyMs: 0, sandbox: false,
        }),
      });
    });
    await page.route('**/api/search/hotels', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          hotels: [{
            id: 'tr-h1', provider: 'liteapi', name: 'Le Test Hôtel', location: 'Paris', city: 'Paris',
            stars: 4, rating: 8.5, reviewCount: 100,
            pricePerNight: 200, totalPrice: 800, currency: 'USD',
            image: 'https://images.unsplash.com/photo-1551918120-9739cb430c6d?w=800&q=80',
            rateId: 'r1', bookingToken: 'tok1', boardType: 'BB', boardName: 'Bed & Breakfast',
          }],
          sources: ['liteapi'], errors: [], latencyMs: 0, sandbox: false,
        }),
      });
    });
    await page.route('**/api/canvas/photos**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ hero: 'https://upload.wikimedia.org/wikipedia/commons/x.jpg', gallery: [] }),
      });
    });

    await page.goto('/trip?new=1');
    await page.waitForURL(/\/trip\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const tripUrl = page.url();
    const tripId  = tripUrl.match(/\/trip\/([0-9a-f-]{36})/)![1];

    // Skip vibe sheet
    const vibe = page.getByRole('heading', { name: /What's your vibe/i });
    try {
      await vibe.waitFor({ state: 'visible', timeout: 4000 });
      await page.getByRole('button', { name: /Skip for now/i }).click();
      await vibe.waitFor({ state: 'hidden' });
    } catch { /* not shown */ }

    // Set home airport
    const homeChip = page.getByRole('button', { name: /set home airport/i });
    if (await homeChip.isVisible().catch(() => false)) {
      await homeChip.click();
      await page.locator('input[placeholder="YYZ"]').fill('YVR');
      await page.keyboard.press('Enter');
    }

    // Add Paris
    await page.getByRole('button', { name: /Add your first stop/i }).click();
    await page.getByLabel(/City or destination/i).fill('Paris');
    await page.getByLabel(/Airport code/i).fill('CDG');
    await page.getByRole('button', { name: /Add to trip/i }).click();
    await expect(page.getByRole('heading', { name: 'Paris' })).toBeVisible();

    // Pick the mocked flight — the whole card is a single button, so click
    // the button that contains the airline name.
    await page.getByRole('button', { name: /Pick a flight/i }).first().click();
    await page.locator('button').filter({ hasText: 'Air Test' }).first().click();
    // Sheet closes after pick → wait for the docked card to appear in the leg
    await expect(page.locator('article').filter({ has: page.getByRole('heading', { name: 'Paris' }) })
      .getByText(/Air Test/)).toBeVisible({ timeout: 5000 });

    // Pick the mocked hotel — each list card has an inline "Pick" button
    // that commits without opening the detail view.
    const parisArticle = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Paris' }) });
    await parisArticle.getByRole('button', { name: /Pick a hotel/i }).click();
    await page.getByRole('button', { name: /^Pick$/i }).first().click();
    await expect(parisArticle.getByText(/Le Test Hôtel/)).toBeVisible({ timeout: 5000 });

    // Continue to checkout
    await page.getByRole('button', { name: /Continue to checkout/i }).click();
    await page.waitForURL(/\/booking/, { timeout: 10_000 });

    // The booking page header should show "Back to your trip", linking to /trip/<id>
    const backLink = page.getByRole('link', { name: /Back to your trip/i }).first();
    await expect(backLink).toBeVisible({ timeout: 10_000 });
    const href = await backLink.getAttribute('href');
    expect(href).toBe(`/trip/${tripId}`);

    // Click it — we should land on the SAME canvas with our picks intact
    await backLink.click();
    await page.waitForURL(new RegExp(`/trip/${tripId}`), { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Paris' })).toBeVisible();
    await expect(page.getByText(/Air Test/).first()).toBeVisible();
    await expect(page.getByText(/Le Test Hôtel/).first()).toBeVisible();
  });
});

test.describe('Reorder slides dates', () => {
  test.setTimeout(120_000);

  test('moving a leg up shifts its dates to the trip start', async ({ page, request }) => {
    async function dbAvailable(): Promise<boolean> {
      try {
        const json = await request.get('/api/health').then(r => r.json());
        return !!json?.db;
      } catch { return false; }
    }
    test.skip(!(await dbAvailable()), 'DB unavailable');

    // Mock photos so the canvas paints quickly without live Wikipedia/Unsplash
    await page.route('**/api/canvas/photos**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          hero: 'https://upload.wikimedia.org/wikipedia/commons/dummy.jpg',
          gallery: ['https://images.unsplash.com/photo-x?w=800'],
        }),
      });
    });

    await page.goto('/trip');
    await page.waitForURL(/\/trip\/[0-9a-f-]{36}/, { timeout: 30_000 });

    // Dismiss vibe sheet
    const vibe = page.getByRole('heading', { name: /What's your vibe/i });
    try {
      await vibe.waitFor({ state: 'visible', timeout: 4000 });
      await page.getByRole('button', { name: /Skip for now/i }).click();
      await vibe.waitFor({ state: 'hidden' });
    } catch { /* not shown */ }

    // Use a narrow viewport so the up/down arrows are visible (mobile mode)
    await page.setViewportSize({ width: 390, height: 844 });

    // ── Add Paris May 15-19, then Tokyo May 19-23 ──────────────────────────
    await page.getByRole('button', { name: /Add your first stop/i }).click();
    await page.getByLabel(/City or destination/i).fill('Paris');
    await page.locator('input[type="date"]').first().fill('2026-05-15');
    await page.locator('input[type="date"]').nth(1).fill('2026-05-19');
    await page.getByRole('button', { name: /Add to trip/i }).click();
    await expect(page.getByRole('heading', { name: 'Paris' })).toBeVisible();

    await page.getByRole('button', { name: /add another chapter/i }).click();
    await page.getByLabel(/City or destination/i).fill('Tokyo');
    await page.locator('input[type="date"]').first().fill('2026-05-19');
    await page.locator('input[type="date"]').nth(1).fill('2026-05-23');
    await page.getByRole('button', { name: /Add to trip/i }).click();
    await expect(page.getByRole('heading', { name: 'Tokyo' })).toBeVisible();

    // Helper: get the date string visible at the top-right of a given leg
    async function legDates(city: string): Promise<string> {
      const article = page.locator('article').filter({ has: page.getByRole('heading', { name: city }) });
      // Heading area shows "May 15 → May 19" in tabular-nums
      const txt = await article.locator('p.tabular-nums').first().textContent();
      return (txt ?? '').trim();
    }

    // Initial state: Paris May 15 → May 19 (4 nights), Tokyo May 19 → May 23 (4 nights)
    expect(await legDates('Paris')).toMatch(/May 15.*May 19/);
    expect(await legDates('Tokyo')).toMatch(/May 19.*May 23/);

    // ── Reorder: move Tokyo up so it becomes leg 1 ─────────────────────────
    const tokyo = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Tokyo' }) });
    await tokyo.getByRole('button', { name: /Move leg up/i }).click();

    // After reorder, the trip start (May 15) stays anchored. Tokyo is now leg
    // 1, so it occupies May 15 → May 19 (its own 4-night duration). Paris
    // shifts to May 19 → May 23.
    await expect.poll(async () => legDates('Tokyo'), { timeout: 5000 }).toMatch(/May 15.*May 19/);
    await expect.poll(async () => legDates('Paris'), { timeout: 5000 }).toMatch(/May 19.*May 23/);
  });
});

test.describe('Real user flow', () => {
  test.setTimeout(180_000);

  test('add → reorder → remove → hotel filters → hotel detail', async ({ page, request }) => {
    test.skip(!(await dbAvailable(request)), 'DB unavailable');

    const screenshots: { step: string; path: string }[] = [];
    const screenshot = async (step: string) => {
      const path = `e2e/.results/flow-${String(screenshots.length).padStart(2, '0')}-${step}.png`;
      await page.screenshot({ path, fullPage: false });
      screenshots.push({ step, path });
    };

    // ── Network mocks for search results ─────────────────────────────────────
    await page.route('**/api/search/flights', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flights: FLIGHT_FIXTURES, sources: ['duffel'], errors: [], latencyMs: 142, sandbox: false,
        }),
      });
    });
    await page.route('**/api/search/hotels', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hotels: HOTEL_FIXTURES, sources: ['liteapi'], errors: [], latencyMs: 217, sandbox: false,
        }),
      });
    });
    await page.route('**/api/hotel-detail**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(HOTEL_DETAIL),
      });
    });

    // ── Step 1: open canvas, dismiss vibe sheet ──────────────────────────────
    await page.goto('/trip');
    await page.waitForURL(/\/trip\/[0-9a-f-]{36}/, { timeout: 30_000 });

    const vibe = page.getByRole('heading', { name: /What's your vibe/i });
    try {
      await vibe.waitFor({ state: 'visible', timeout: 5000 });
      await page.getByRole('button', { name: /Beach & sun/i }).click();
      await page.getByRole('button', { name: /Save vibes/i }).click();
      await vibe.waitFor({ state: 'hidden' });
    } catch { /* may not appear */ }
    await screenshot('canvas-empty');

    // ── Step 2: set home airport ────────────────────────────────────────────
    const homeChip = page.getByRole('button', { name: /set home airport/i });
    if (await homeChip.isVisible().catch(() => false)) {
      await homeChip.click();
      await page.locator('input[placeholder="YYZ"]').fill('YVR');
      await page.keyboard.press('Enter');
    }

    // ── Step 3: add Paris ───────────────────────────────────────────────────
    await page.getByRole('button', { name: /Add your first stop/i }).click();
    await page.getByLabel(/City or destination/i).fill('Paris');
    await page.getByLabel(/Airport code/i).fill('CDG');
    await page.getByRole('button', { name: /Add to trip/i }).click();
    await expect(page.getByRole('heading', { name: 'Paris' })).toBeVisible();
    // Wait for map to settle
    await page.waitForTimeout(1500);
    await screenshot('one-leg-paris');

    // Map should have one destination marker (CDG); could also have YVR home origin
    const markersAfter1 = await page.locator('.mapboxgl-marker').count();
    expect(markersAfter1).toBeGreaterThanOrEqual(1);
    expect(markersAfter1).toBeLessThanOrEqual(2);

    // ── Step 4: add Tokyo ───────────────────────────────────────────────────
    await page.getByRole('button', { name: /add another chapter/i }).click();
    await page.getByLabel(/City or destination/i).fill('Tokyo');
    await page.getByLabel(/Airport code/i).fill('NRT');
    await page.getByRole('button', { name: /Add to trip/i }).click();
    await expect(page.getByRole('heading', { name: 'Tokyo' })).toBeVisible();
    await page.waitForTimeout(1500);
    await screenshot('two-legs-paris-tokyo');

    const markersAfter2 = await page.locator('.mapboxgl-marker').count();
    expect(markersAfter2).toBeGreaterThan(markersAfter1);          // marker count grew
    expect(markersAfter2).toBeLessThanOrEqual(3);                   // never more than 3 (home + 2 dests)

    // ── Step 5: remove Paris and verify map prunes its marker ──────────────
    const parisArticle = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Paris' }) });
    await parisArticle.getByRole('button', { name: /Remove leg/i }).click();
    await expect(page.getByRole('heading', { name: 'Paris' })).toHaveCount(0);
    // Important: after removal, marker count must SHRINK — this is the stale-pin bug
    await expect.poll(async () => page.locator('.mapboxgl-marker').count(), { timeout: 5000 })
      .toBeLessThan(markersAfter2);
    await screenshot('after-remove-paris');

    // ── Step 6: add Paris back so we have material for filter testing ──────
    await page.getByRole('button', { name: /add another chapter/i }).click();
    await page.getByLabel(/City or destination/i).fill('Paris');
    await page.getByLabel(/Airport code/i).fill('CDG');
    await page.getByRole('button', { name: /Add to trip/i }).click();
    await expect(page.getByRole('heading', { name: 'Paris' })).toBeVisible();

    // ── Step 7: open Paris hotel picker ─────────────────────────────────────
    const newParis = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Paris' }) });
    await newParis.getByRole('button', { name: /Pick a hotel/i }).click();

    // Sheet header
    await expect(page.getByText(/^Pick a hotel$/i).last()).toBeVisible();
    await expect(page.getByText(/3 hotels/i).first()).toBeVisible({ timeout: 10_000 });
    await screenshot('hotels-listed');

    // ── Step 8: verify hotel images render in the list ─────────────────────
    // HotelThumb renders a real <img> so we can detect 404s and gracefully
    // fall back. Assert at least one card's <img> alt matches the hotel and
    // its src points at the fixture URL.
    const hotelImgs = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img[alt]')) as HTMLImageElement[];
      return imgs
        .map(i => ({ alt: i.alt, src: i.currentSrc || i.src }))
        .filter(i => i.alt && i.src);
    });
    const grandHotel = hotelImgs.find(i => i.alt.includes('Hôtel Marais') && i.src.includes('unsplash'));
    expect(grandHotel, JSON.stringify(hotelImgs, null, 2)).toBeTruthy();

    // ── Step 9: filter by free cancellation ─────────────────────────────────
    // h1 is RFN, h2/h3 are NRFN → expect 1 result after click
    await page.getByRole('button', { name: /Free cancel/i }).click();
    await expect(page.getByText(/1 of 3 hotels/i)).toBeVisible({ timeout: 5000 });
    await screenshot('filter-free-cancel');
    await page.getByRole('button', { name: /\[ clear \]/i }).click();
    await expect(page.getByText(/3 hotels/i).first()).toBeVisible();

    // ── Step 10: filter by 4+ stars ─────────────────────────────────────────
    // h1=5, h2=2, h3=4 → expect 2 results
    await page.getByRole('button', { name: /4\+ ★/i }).click();
    await expect(page.getByText(/2 of 3 hotels/i)).toBeVisible({ timeout: 5000 });
    await screenshot('filter-4plus-stars');
    await page.getByRole('button', { name: /\[ clear \]/i }).click();

    // ── Step 11: name search ────────────────────────────────────────────────
    await page.getByPlaceholder(/Search by hotel name/i).fill('Pullman');
    await expect(page.getByText(/1 of 3 hotels/i)).toBeVisible({ timeout: 5000 });
    await screenshot('filter-name-pullman');
    await page.getByRole('button', { name: /\[ clear \]/i }).click();

    // ── Step 12: open hotel detail ─────────────────────────────────────────
    await page.getByRole('button', { name: /Le Grand Hôtel Marais/ }).first().click();
    await expect(page.getByRole('heading', { name: /Le Grand Hôtel Marais/ })).toBeVisible();
    await page.waitForTimeout(1000);

    // Detail must show:
    //  - board-type pill (Bed & Breakfast)
    //  - free-cancellation pill
    //  - amenities grid
    //  - mini-map (Mapbox static)
    //  - cancellation timeline (cancelPolicies)
    //  - taxes & fees breakdown
    await expect(page.getByText(/Breakfast included/i).first()).toBeVisible();
    await expect(page.getByText(/^Free cancellation$/i).first()).toBeVisible();
    await expect(page.getByText(/^Amenities$/i)).toBeVisible();
    await expect(page.getByText(/Indoor swimming pool/i)).toBeVisible();
    await expect(page.getByText(/^Location$/i)).toBeVisible();
    await expect(page.getByText(/^Cancellation policy$/i)).toBeVisible();
    await expect(page.getByText(/Free cancellation$/i).first()).toBeVisible();
    await expect(page.getByText(/Taxes & fees|Taxes ?& ?fees/i).first()).toBeVisible();
    await screenshot('hotel-detail-full');

    // Assert the carousel hero img has a real Unsplash url, not blank
    const detailHero = await page.evaluate(() => {
      const el = document.querySelector('[role="img"][aria-label="Le Grand Hôtel Marais"]') as HTMLElement | null;
      if (!el) return null;
      return el.style.backgroundImage;
    });
    expect(detailHero, 'Detail hero must reference Unsplash photo').toMatch(/images\.unsplash\.com/);

    // Click next-photo arrow → background should change
    const nextBtn = page.getByRole('button', { name: /Next photo/i });
    if (await nextBtn.isVisible().catch(() => false)) {
      const before = detailHero;
      await nextBtn.click();
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => {
        const el = document.querySelector('[role="img"][aria-label="Le Grand Hôtel Marais"]') as HTMLElement | null;
        return el?.style.backgroundImage ?? '';
      });
      expect(after).not.toBe(before);
    }

    // ── Step 13: pick this hotel and confirm it docks into the leg ─────────
    await page.getByRole('button', { name: /^Pick this hotel$/i }).click();
    await expect(page.getByText(/Le Grand Hôtel Marais/).first()).toBeVisible();
    await screenshot('hotel-picked');

    // Print where the screenshots went so the dev can review them
    console.log('\nFlow screenshots:');
    for (const s of screenshots) console.log(`  ${s.step.padEnd(28)} ${s.path}`);
  });
});
