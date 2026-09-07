import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { test as base, expect, type Page } from '@playwright/test';

import { signIn } from './fixtures';

/**
 * Browser acceptance gate for the refined Commercial workspace (Phase 4).
 *
 * Run manually against a live API and a project that has a client contract:
 *   QA_PROJECT_ID=<id> pnpm --filter @erp/web exec playwright test commercial-workspace-qa
 *
 * It exists because three classes of defect are invisible to the unit suite and to a
 * screenshot: page-level horizontal overflow at 375px, a touch target under 44px, and a
 * console error or 4xx that only fires against a real server. Everything it asserts is
 * measured off the DOM rather than eyeballed — `getComputedStyle` and `getBoundingClientRect`
 * are the only witnesses that do not flatter the layout.
 */

const PROJECT_ID = process.env['QA_PROJECT_ID'] ?? '';
/** Optional second project on the other billing model, to prove the nav actually branches. */
const IPC_PROJECT_ID = process.env['QA_IPC_PROJECT_ID'] ?? '';
const OUT = resolve(process.cwd(), 'e2e/.artifacts/commercial-qa');
mkdirSync(OUT, { recursive: true });

const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await signIn(page);
    await use(page);
  },
});

// English-only since PR #73. Light and dark are both first-class and both must pass.
const THEMES = ['light', 'dark'] as const;

const VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 900 },
  { id: 'mobile', width: 375, height: 812 },
] as const;

function pagesFor(projectId: string) {
  return [
    { id: 'overview', path: `/projects/${projectId}/commercial` },
    { id: 'contract-security', path: `/projects/${projectId}/commercial/contract-security` },
    { id: 'variations', path: `/projects/${projectId}/commercial/variations` },
    { id: 'billing-collection', path: `/projects/${projectId}/commercial/billing-collection` },
    // A MILESTONE contract should redirect this to the explanation, not a blank screen.
    { id: 'applications', path: `/projects/${projectId}/commercial/applications` },
  ];
}

/**
 * Interactive controls inside the Commercial surface only, with a 44px verdict.
 *
 * Scoped to `[data-commercial-root]` so the app shell's breadcrumbs and the project tab row —
 * neither owned by this phase — are excluded. Links inside a paragraph are excluded too: an
 * inline link inherits the sentence's line height and is not a touch target.
 */
async function measureControls(page: Page) {
  return page.evaluate(() => {
    const MIN = 44;
    const root = document.querySelector('[data-commercial-root]');
    if (!root) return [];
    const controls: { text: string; w: number; h: number; underH: boolean }[] = [];
    for (const el of root.querySelectorAll('button, a[href], select, [role="tab"]')) {
      if (el.closest('nextjs-portal') || el.classList.contains('tsqd-open-btn')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.clip === 'rect(0px, 0px, 0px, 0px)' || rect.height <= 1) continue;
      if (el.tagName === 'A' && el.closest('p')) continue;
      controls.push({
        text: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        underH: rect.height < MIN,
      });
    }
    return controls;
  });
}

test.skip(!PROJECT_ID, 'Set QA_PROJECT_ID to a project with a client contract');

/**
 * ADR-023: the tab set is the contract's, not the tenant's. A payment-schedule contract has no
 * IPA/IPC workflow, so Applications & Certification must be absent — and a deep link into it must
 * explain itself rather than render a blank workspace. Proving that needs one project of each
 * billing model, which is why this test is skipped unless both are supplied.
 */
test('navigation branches on the contract billing model', async ({ app }) => {
  test.skip(!IPC_PROJECT_ID, 'Set QA_IPC_PROJECT_ID to a MEASURED_IPC project');

  await app.goto(`/projects/${PROJECT_ID}/commercial`);
  await app.getByRole('heading', { name: 'Commercial', exact: true, level: 2 }).waitFor();
  const milestoneNav = app.getByRole('navigation', { name: 'Commercial sections' });
  await expect(milestoneNav.getByRole('link', { name: 'Billing & Collection' })).toBeVisible();
  await expect(
    milestoneNav.getByRole('link', { name: 'Applications & Certification' }),
  ).toHaveCount(0);

  // Deep-linking into the hidden view explains itself instead of showing an empty workspace.
  await app.goto(`/projects/${PROJECT_ID}/commercial/applications`);
  await expect(
    app.getByText('This contract has no application workflow'),
  ).toBeVisible();

  await app.goto(`/projects/${IPC_PROJECT_ID}/commercial`);
  await app.getByRole('heading', { name: 'Commercial', exact: true, level: 2 }).waitFor();
  await expect(
    app
      .getByRole('navigation', { name: 'Commercial sections' })
      .getByRole('link', { name: 'Applications & Certification' }),
  ).toBeVisible();
});

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`commercial ${viewport.id} ${theme}`, async ({ app, page }) => {
      test.slow();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await app.addInitScript((value) => {
        try {
          localStorage.setItem('rukna.theme.preference', value as string);
        } catch {
          /* private mode */
        }
      }, theme);

      const consoleErrors: string[] = [];
      app.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      const failedRequests: string[] = [];
      app.on('response', (response) => {
        if (response.url().includes('/commercial') && response.status() >= 400) {
          failedRequests.push(`${response.status()} ${response.url()}`);
        }
      });

      const undersized: { page: string; text: string; w: number; h: number }[] = [];

      for (const target of pagesFor(PROJECT_ID)) {
        await app.goto(target.path);
        await app.getByRole('heading', { name: 'Commercial', exact: true, level: 2 }).waitFor();
        await app.waitForLoadState('networkidle');

        await expect(app.locator('html')).toHaveAttribute('data-theme', theme);

        const metrics = await app.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        const controls = await measureControls(app);
        const under = viewport.id === 'mobile' ? controls.filter((c) => c.underH) : [];
        for (const control of under) {
          undersized.push({ page: target.id, text: control.text, w: control.w, h: control.h });
        }

        // The machine-readable line the runner greps for.
        console.log(
          `[QA] ${viewport.id}-${theme} ${target.id} ` +
            `scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth} ` +
            `overflow=${metrics.scrollWidth > metrics.clientWidth + 1} ` +
            `controls=${controls.length} under44=${JSON.stringify(under)}`,
        );

        await app.screenshot({
          path: `${OUT}/${target.id}-${viewport.id}-${theme}.png`,
          fullPage: true,
        });

        // A wide table must scroll inside its own container; the page must never scroll.
        expect(
          metrics.scrollWidth,
          `page-level horizontal overflow at ${viewport.id}-${theme} ${target.id}`,
        ).toBeLessThanOrEqual(metrics.clientWidth + 1);
      }

      console.log(
        `[QA] ${viewport.id}-${theme} consoleErrors=${JSON.stringify(consoleErrors)} ` +
          `failedApi=${JSON.stringify(failedRequests)}`,
      );

      expect(failedRequests, `Commercial API failures in ${viewport.id}-${theme}`).toEqual([]);
      expect(
        undersized,
        `Commercial controls under 44px tall in ${viewport.id}-${theme}`,
      ).toEqual([]);
    });
  }
}
