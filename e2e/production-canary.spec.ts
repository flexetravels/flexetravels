import { expect, test } from '@playwright/test';

const PROD_URL = process.env.PROD_URL || process.env.NEXT_PUBLIC_APP_URL || '';

test.describe('production canary', () => {
  test.skip(!PROD_URL, 'Set PROD_URL=https://... to run production canaries');

  test('public root and support dashboard shell render without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(PROD_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('FlexeTravels').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /flights/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /hotels/i }).first()).toBeVisible();

    await page.goto(`${PROD_URL.replace(/\/$/, '')}/admin/support`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Support Lookup|Find a customer session fast/i)).toBeVisible();

    expect(errors.filter(error => !/favicon|ResizeObserver/i.test(error))).toEqual([]);
  });

  test('mobile root does not horizontally overflow', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });
    const page = await context.newPage();
    await page.goto(PROD_URL, { waitUntil: 'domcontentloaded' });
    const metrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 2);
    await context.close();
  });

  test('version endpoint returns deployment metadata', async ({ request }) => {
    const res = await request.get(`${PROD_URL.replace(/\/$/, '')}/api/version`, {
      headers: { 'User-Agent': 'FlexeTravelsCanary/1.0' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.app).toBe('flexetravels-next');
    expect(body.generatedAt).toBeTruthy();
  });

  test('stripe prepare invalid request fails safely without creating payment', async ({ request }) => {
    const res = await request.post(`${PROD_URL.replace(/\/$/, '')}/api/stripe/prepare`, {
      headers: { 'User-Agent': 'FlexeTravelsCanary/1.0' },
      data: { bookingReference: '' },
    });
    expect([400, 429, 503]).toContain(res.status());
    const text = await res.text();
    expect(text).not.toMatch(/sk_live|DUFFEL_ACCESS_TOKEN|STRIPE_SECRET_KEY|stack/i);
  });
});
