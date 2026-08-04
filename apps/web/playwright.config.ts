import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * These tests exist for the two things the unit and component suites structurally cannot
 * reach:
 *
 *  1. **The billing chain across screens.** Every figure on a payment application comes
 *     from data the client does not hold — a previously certified quantity lives on a
 *     certificate against an earlier application. A test that mocks the API cannot prove
 *     the chain agrees with itself; only walking it against a real server can.
 *  2. **A real 375px viewport.** `apps/web/CLAUDE.md` requires every screen to work at
 *     375px, and that has been unverifiable throughout this phase — Chrome on Windows
 *     refuses to size a window below its minimum, so browser QA could never actually see
 *     it. Playwright sets the viewport directly, independent of the window.
 *
 * Requires the API and a tenant database. `globalSetup` seeds a full scenario over HTTP
 * before anything runs, so the suite does not depend on whatever happens to be in the
 * database.
 */
const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://acco.localhost:3000';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // Money assertions must not race a stale render; generous but not unbounded.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Serial: the tests share one seeded scenario and one tenant database.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',

  use: {
    baseURL: BASE_URL,
    // The tenant is resolved from the request host, so every navigation must go to
    // acco.localhost rather than localhost. Chromium treats the whole `.localhost` TLD as
    // loopback (RFC 6761), so this needs no hosts-file entry.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } },
    },
    {
      // 375×812 — the viewport CLAUDE.md mandates and the one nothing else could test.
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 375, height: 812 } },
    },
  ],

  webServer: {
    command: 'npm run dev',
    /**
     * The probe goes to plain `localhost`, not `acco.localhost` like every other request.
     *
     * Playwright checks readiness from Node, and Node on Windows cannot resolve arbitrary
     * `*.localhost` subdomains — the same limitation the seed script works around. Probing
     * the tenant host makes Playwright conclude nothing is listening and start a SECOND dev
     * server on another port, which then fails because one is already running.
     *
     * `/login` rather than `/`, which redirects. The probe only needs to know something is
     * serving on the port; the browser handles the tenant host itself.
     */
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
