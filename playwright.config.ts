import { defineConfig, devices } from '@playwright/test';

// Lightweight e2e harness for the Trip Canvas flows. Boots a dev server on
// port 3920 (chosen to avoid colliding with whatever is already running) with
// the canvas flag forced on, then exercises the public UI.
//
// Tests intentionally avoid hitting Duffel/LiteAPI/Stripe/Anthropic — those
// are network-bound and would be flaky. Anything that requires a live
// provider key is gated behind `test.skip(!process.env.E2E_LIVE)`.

const PORT = Number(process.env.E2E_PORT ?? 3920);

export default defineConfig({
  testDir:  './e2e',
  outputDir: './e2e/.results',
  // The dev server takes a few seconds to compile each route on first hit.
  timeout:  60_000,
  expect:   { timeout: 10_000 },
  fullyParallel: false,
  workers:       1,    // canvas + visual tests share the dev server's session state; 1 worker keeps them sequential
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL:    `http://localhost:${PORT}`,
    headless:   true,
    trace:      'retain-on-failure',
    screenshot: 'only-on-failure',
    video:      'off',
  },
  projects: [
    {
      name: 'chromium',
      use:  { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `PORT=${PORT} NEXT_PUBLIC_TRIP_CANVAS=true npx next dev -p ${PORT}`,
    url:     `http://localhost:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout:  'ignore',
    stderr:  'pipe',
  },
});
