// ─── Playwright Browser Singleton ────────────────────────────────────────────
// Lazy-initialised, headless Chromium for airline automation flows.
//
// IMPORTANT: Never call this directly from an API request cycle.
//            All Playwright work runs inside the queue worker (lib/queue).
//
// Railway setup: add to package.json scripts →
//   "postinstall": "npx playwright install chromium --with-deps"

let _browserPromise: Promise<import('playwright-core').Browser> | null = null;

async function launchBrowser(): Promise<import('playwright-core').Browser> {
  try {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
    });
    browser.on('disconnected', () => { _browserPromise = null; });
    return browser;
  } catch (e) {
    _browserPromise = null;
    throw new Error(
      `Playwright not available: ${String(e)}\n` +
      'Run: npx playwright install chromium --with-deps'
    );
  }
}

export async function getBrowser(): Promise<import('playwright-core').Browser> {
  if (!_browserPromise) {
    _browserPromise = launchBrowser();
  }
  return _browserPromise;
}

export async function newPage(): Promise<import('playwright-core').Page> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport:  { width: 1280, height: 800 },
    locale:    'en-US',
    timezoneId: 'America/Vancouver',
  });
  return ctx.newPage();
}

export async function closeBrowser(): Promise<void> {
  if (_browserPromise) {
    try {
      const b = await _browserPromise;
      await b.close();
    } catch { /* already closed */ }
    _browserPromise = null;
  }
}

/** Check if playwright browsers are installed without crashing */
export async function playwrightAvailable(): Promise<boolean> {
  try {
    await import('playwright-core');
    return true;
  } catch {
    return false;
  }
}
