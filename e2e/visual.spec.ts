import { test } from '@playwright/test';

// Visual sanity captures — saved to e2e/.results for manual review.
// These don't fail the build; they're for "did this look right?" verification.

test('capture Montreal canvas screenshot — relevance check', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto('/trip');
  await page.waitForURL(/\/trip\/[0-9a-f-]{36}/, { timeout: 30_000 });

  const vibe = page.getByRole('heading', { name: /What's your vibe/i });
  try {
    await vibe.waitFor({ state: 'visible', timeout: 4000 });
    await page.getByRole('button', { name: /Skip for now/i }).click();
    await vibe.waitFor({ state: 'hidden' });
  } catch { /* not shown */ }

  await page.getByRole('button', { name: /Add your first stop/i }).click();
  await page.getByLabel(/City or destination/i).fill('Montreal');
  await page.getByLabel(/Airport code/i).fill('YUL');
  await page.getByRole('button', { name: /Add to trip/i }).click();
  await page.getByRole('heading', { name: 'Montreal' }).waitFor();

  await page.waitForFunction(() => {
    const el = document.querySelector('[role="img"][aria-label="Montreal"]');
    if (!el) return false;
    const s = (el as HTMLElement).style.backgroundImage || '';
    return s.includes('upload.wikimedia.org') || s.includes('ixid=');
  }, { timeout: 15_000 }).catch(() => {});

  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'e2e/.results/canvas-montreal.png', fullPage: true });
});

test('capture Puerto Vallarta canvas + booking screenshots', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/trip');
  await page.waitForURL(/\/trip\/[0-9a-f-]{36}/, { timeout: 30_000 });

  // Dismiss the vibe sheet if present
  const vibeHeading = page.getByRole('heading', { name: /What's your vibe/i });
  try {
    await vibeHeading.waitFor({ state: 'visible', timeout: 4000 });
    await page.getByRole('button', { name: /Beach & sun/i }).click();
    await page.getByRole('button', { name: /Save vibes/i }).click();
    await vibeHeading.waitFor({ state: 'hidden' });
  } catch { /* not shown */ }

  // Set home airport to YVR
  const homeChip = page.getByRole('button', { name: /set home airport/i });
  if (await homeChip.isVisible().catch(() => false)) {
    await homeChip.click();
    await page.locator('input[placeholder="YYZ"]').fill('YVR');
    await page.keyboard.press('Enter');
  }

  // Add Puerto Vallarta leg
  await page.getByRole('button', { name: /Add your first stop/i }).click();
  await page.getByLabel(/City or destination/i).fill('Puerto Vallarta');
  await page.getByLabel(/Airport code/i).fill('PVR');
  await page.getByRole('button', { name: /Add to trip/i }).click();
  await page.getByRole('heading', { name: 'Puerto Vallarta' }).waitFor();

  // Wait for the live photo to land — the hero either comes from Wikipedia
  // (upload.wikimedia.org) for canonical landmarks or Unsplash search
  // (?ixid=...) for variety. The themed fallback uses a bare images.unsplash
  // URL with NEITHER, so we wait until the bg-image has one of the live
  // markers. Falls through to a timeout-and-screenshot if the API was slow.
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="img"][aria-label="Puerto Vallarta"]');
    if (!el) return false;
    const style = (el as HTMLElement).style.backgroundImage || '';
    return style.includes('upload.wikimedia.org') || style.includes('ixid=');
  }, { timeout: 15_000 }).catch(() => {});

  // Small extra slack so the photo bytes finish downloading before we paint
  await page.waitForTimeout(1500);
  await page.screenshot({
    path:     'e2e/.results/canvas-pv.png',
    fullPage: true,
  });

  // Now seed a fake cart and screenshot /booking with the Trip total line
  await page.evaluate(() => {
    window.sessionStorage.setItem('ft_cart', JSON.stringify({
      flight: {
        id:'t1', offerId:'t1',
        airline:'American Airlines', origin:'YVR', destination:'PVR',
        departure:'2026-05-30T08:00:00', arrival:'2026-05-30T13:18:00',
        duration:'5h 18m', stops:0,
        price:403, currency:'USD', cabinClass:'economy',
      },
      hotel: {
        id:'h1', rateId:'r1',
        name:'Marriott Puerto Vallarta Resort & Spa', city:'Puerto Vallarta',
        checkIn:'2026-05-30', checkOut:'2026-06-06',
        pricePerNight:247, totalPrice:1732, currency:'USD',
        starRating:5, reviewScore:8.7,
      },
      adults:2, children:0, savedAt:Date.now(), source:'canvas',
    }));
  });

  await page.goto('/booking');
  await page.waitForTimeout(2000);
  await page.screenshot({
    path:     'e2e/.results/booking-pv.png',
    fullPage: false,
  });
});
