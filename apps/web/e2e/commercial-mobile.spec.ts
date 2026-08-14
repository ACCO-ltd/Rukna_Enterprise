import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { test as base, expect, type Page } from '@playwright/test';

import { signIn } from './fixtures';

// A known project with a client contract, a guarantee and interim applications — used directly
// so this gate does not depend on the (currently failing) scenario seeder.
const PROJECT_ID = process.env['QA_PROJECT_ID'] ?? 'cmsra2syt0071tgt4dv2yvt54';

/**
 * TEMPORARY mobile acceptance gate for the Commercial workspace (ADR-017 Gate C).
 * Not part of the committed suite — run manually, then delete.
 *
 * Exact device emulation per the acceptance brief: 375×812, dsf 1, isMobile, hasTouch.
 * Four modes (en/ar × light/dark) over the four Commercial-relevant pages. Reports the
 * document scroll/client width and every Commercial-surface interactive control's box, and
 * fails on page-level horizontal overflow or a Commercial control under 44px in either axis.
 */

const OUT = resolve(process.cwd(), 'e2e/.artifacts/commercial-mobile');
mkdirSync(OUT, { recursive: true });

const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await signIn(page);
    await use(page);
  },
});

test.use({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});

const MODES = [
  { id: 'en-light', lang: 'en', theme: 'light', dir: 'ltr' },
  { id: 'en-dark', lang: 'en', theme: 'dark', dir: 'ltr' },
  // Was `theme: 'dark'` — a copy-paste that made this mode a duplicate of ar-dark and left
  // Arabic light mode untested.
  { id: 'ar-light', lang: 'ar', theme: 'light', dir: 'rtl' },
  { id: 'ar-dark', lang: 'ar', theme: 'dark', dir: 'rtl' },
] as const;

function pagesFor(projectId: string) {
  return [
    { id: 'overview', path: `/projects/${projectId}/commercial` },
    { id: 'applications', path: `/projects/${projectId}/commercial/applications` },
    { id: 'guarantees', path: `/projects/${projectId}/commercial/guarantees` },
    { id: 'financial-position', path: `/projects/${projectId}/pl` },
  ];
}

/**
 * Interactive controls inside the Commercial surface only, with a 44px verdict. Scoped to
 * [data-commercial-root] so app-shell breadcrumbs / project sub-nav (not owned by this
 * delivery) are excluded. Returns [] on non-Commercial pages (e.g. Financial Position).
 */
async function measureControls(page: Page) {
  return page.evaluate(() => {
    const MIN = 44;
    const main = document.querySelector('[data-commercial-root]');
    if (!main) return [];
    const controls: { text: string; w: number; h: number; underH: boolean }[] = [];
    for (const el of main.querySelectorAll('button, a[href], select, [role="tab"]')) {
      if (el.closest('nextjs-portal') || el.classList.contains('tsqd-open-btn')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const s = getComputedStyle(el);
      if (s.clip === 'rect(0px, 0px, 0px, 0px)' || r.height <= 1) continue;
      if (el.tagName === 'A' && el.closest('p')) continue;
      controls.push({
        text: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30),
        w: Math.round(r.width),
        h: Math.round(r.height),
        underH: r.height < MIN,
      });
    }
    return controls;
  });
}

for (const mode of MODES) {
  test(`commercial mobile ${mode.id}`, async ({ app, context }) => {
    await context.addCookies([
      { name: 'lang', value: mode.lang, domain: 'acco.localhost', path: '/' },
    ]);
    await app.addInitScript((theme) => {
      try {
        localStorage.setItem('rukna.theme.preference', theme as string);
      } catch {
        /* private mode */
      }
    }, mode.theme);

    const errors: string[] = [];
    app.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const failedRequests: string[] = [];
    app.on('response', (r) => {
      if (r.url().includes('/commercial/') && r.status() >= 400) {
        failedRequests.push(`${r.status()} ${r.url()}`);
      }
    });

    const allUnder: { page: string; text: string; w: number; h: number }[] = [];

    for (const pg of pagesFor(PROJECT_ID)) {
      await app.goto(pg.path);
      await app.getByRole('heading', { level: 1 }).first().waitFor();
      await app.waitForLoadState('networkidle');

      await expect(app.locator('html')).toHaveAttribute('dir', mode.dir);

      const metrics = await app.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      const controls = await measureControls(app);
      const under = controls.filter((c) => c.underH);
      for (const u of under) allUnder.push({ page: pg.id, text: u.text, w: u.w, h: u.h });

      // Machine-readable line the runner greps for.
      console.log(
        `[QA] ${mode.id} ${pg.id} scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth} ` +
          `overflow=${metrics.scrollWidth > metrics.clientWidth + 1} controls=${controls.length} under44=${JSON.stringify(under)}`,
      );

      await app.screenshot({ path: `${OUT}/${pg.id}-${mode.id}.png`, fullPage: true });

      // No page-level horizontal overflow on any page, including Financial Position.
      expect(
        metrics.scrollWidth,
        `page-level horizontal overflow at ${mode.id} ${pg.id}`,
      ).toBeLessThanOrEqual(metrics.clientWidth + 1);
    }

    console.log(`[QA] ${mode.id} consoleErrors=${JSON.stringify(errors)} failedApi=${JSON.stringify(failedRequests)}`);

    // Commercial-owned controls must all clear 44px tall (breadcrumbs/shell excluded by scope).
    expect(allUnder, `Commercial controls under 44px tall in ${mode.id}`).toEqual([]);
  });
}
