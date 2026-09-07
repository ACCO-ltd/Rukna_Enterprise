import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { test as base, expect, type Page } from '@playwright/test';

import { signIn } from './fixtures';

/**
 * Browser acceptance gate for the project Procurement workspace (Phase 5).
 *
 *   E2E_SKIP_SEED=1 RUKNA_DEMO_PASSWORD=… QA_BUDGETED_PROJECT_ID=… QA_UNBUDGETED_PROJECT_ID=… \
 *     pnpm --filter @erp/web exec playwright test project-procurement-qa --project=desktop
 *
 * Two projects, deliberately: one with a BASELINED cost budget and one without. The
 * null-versus-zero rule is the kind of semantic defect that renders as a perfectly tidy "0.0%"
 * and is invisible to every other kind of test, so it gets its own assertions on both sides.
 */

const BUDGETED = process.env['QA_BUDGETED_PROJECT_ID'] ?? '';
const UNBUDGETED = process.env['QA_UNBUDGETED_PROJECT_ID'] ?? '';
const OUT = resolve(process.cwd(), 'e2e/.artifacts/project-procurement-qa');
mkdirSync(OUT, { recursive: true });

const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await signIn(page);
    await use(page);
  },
});

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 900 },
  { id: 'mobile', width: 375, height: 812 },
] as const;

const VIEWS = ['Overview', 'Requirements', 'Cost & Commitments'] as const;

/** Interactive controls inside the Procurement surface only, with a 44px verdict. */
async function measureControls(page: Page) {
  return page.evaluate(() => {
    const MIN = 44;
    const root = document.querySelector('[data-project-procurement-root]');
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

test.skip(!BUDGETED || !UNBUDGETED, 'Set QA_BUDGETED_PROJECT_ID and QA_UNBUDGETED_PROJECT_ID');

/**
 * The rule the whole budget feature rests on: no baselined budget means no denominator, so the
 * ratio is **absent**, not `0%`. A screen that renders "0.0% of budget" on an unbudgeted project
 * invents a control nobody configured, and it looks completely correct while doing it.
 */
test('states the absence of a budget rather than reporting zero percent', async ({ app }) => {
  await app.goto(`/projects/${UNBUDGETED}/procurement`);
  await app.getByRole('heading', { name: 'Procurement', exact: true, level: 2 }).waitFor();
  await app.waitForLoadState('networkidle');

  await expect(app.getByText('No cost budget baselined')).toBeVisible();

  const root = app.locator('[data-project-procurement-root]');
  // Neither a percentage nor a budget column may appear anywhere on an unbudgeted project.
  await expect(root.getByText(/% of budget/i)).toHaveCount(0);
  await expect(root.getByText(/0\.0%/)).toHaveCount(0);
  await expect(root.getByText('Uncommitted budget')).toHaveCount(0);

  // The ledger stages are still stated — they exist with or without a budget.
  await expect(root.getByText('Committed', { exact: true }).first()).toBeVisible();
});

/** With a budget, ratios become valid — including a genuine zero, which is a different fact. */
test('measures each stage against a baselined budget, naming its numerator', async ({ app }) => {
  await app.goto(`/projects/${BUDGETED}/procurement`);
  await app.getByRole('heading', { name: 'Procurement', exact: true, level: 2 }).waitFor();
  await app.waitForLoadState('networkidle');

  const root = app.locator('[data-project-procurement-root]');
  await expect(app.getByText('No cost budget baselined')).toHaveCount(0);
  await expect(root.getByText('Budget', { exact: true }).first()).toBeVisible();

  // Every ratio carries its own numerator. A bare "% of budget" beside three cost stages is a
  // guessing game about which one it divides.
  await expect(root.getByText('Committed / budget').first()).toBeVisible();
  await expect(root.getByText('Actual / budget').first()).toBeVisible();

  // The two remainders are distinct concepts and the band says so rather than picking one word.
  await expect(root.getByText(/Uncommitted budget .* is what is still free to spend/)).toBeVisible();
});

/**
 * Project cost with no BOQ line is legitimate — site overhead, transport, insurance — and gets a
 * named row of its own. Calling it "other" or "unallocated" would imply somebody failed to code it.
 */
test('names project-level non-BOQ cost as its own row', async ({ app }) => {
  await app.goto(`/projects/${BUDGETED}/procurement`);
  await app.getByRole('heading', { name: 'Procurement', exact: true, level: 2 }).waitFor();
  await app.getByRole('tab', { name: 'Cost & Commitments' }).click();
  await app.waitForLoadState('networkidle');

  const root = app.locator('[data-project-procurement-root]');
  await expect(root.getByText('Project-level (non-BOQ)').first()).toBeVisible();
  await expect(root.getByText(/Other \/ Unallocated/i)).toHaveCount(0);

  /**
   * And it is a spendable bucket, not a budget-only artefact. Expanding it must reveal the named
   * spend categories the cost was coded to — a budget category that can never receive actual
   * cost is a reporting artefact, and this is the assertion that keeps it from becoming one.
   */
  await root.getByRole('button', { name: /expand/i }).last().click();
  await expect(root.getByText('Transport').first()).toBeVisible();
});

/**
 * The requirement detail panel.
 *
 * Three tabs, and the two that are absent are absent on purpose: **History** has no
 * resource-scoped audit endpoint behind it, and **Attachments** has no model and no file serving.
 * A tab that renders an empty feed advertises a capability the platform does not have, so this
 * asserts they stay gone rather than trusting nobody adds them back.
 */
test('opens a requirement without advertising history or attachments', async ({ app }) => {
  await app.goto(`/projects/${BUDGETED}/procurement`);
  await app.getByRole('heading', { name: 'Procurement', exact: true, level: 2 }).waitFor();
  await app.getByRole('tab', { name: 'Requirements' }).click();
  await app.waitForLoadState('networkidle');

  await app.getByRole('button', { name: 'Open' }).first().click();
  const dialog = app.getByRole('dialog');
  await expect(dialog.getByRole('tab', { name: 'Details' })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /^Items/ })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /^Purchase orders/ })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /history/i })).toHaveCount(0);
  await expect(dialog.getByRole('tab', { name: /attachment/i })).toHaveCount(0);

  // Approval and fulfilment stay two facts, in the panel as in the list.
  await expect(dialog.getByText('Estimated value').first()).toBeVisible();

  // The line's own cost target — the header carries none and none is invented.
  await dialog.getByRole('tab', { name: /^Items/ }).click();
  await expect(dialog.getByText('Cost target').first()).toBeVisible();
});

/** The project owns requirements and nothing else. No PO, GRN, bill or payment authoring here. */
test('offers no supplier-document authoring', async ({ app }) => {
  await app.goto(`/projects/${BUDGETED}/procurement`);
  await app.getByRole('heading', { name: 'Procurement', exact: true, level: 2 }).waitFor();
  await app.waitForLoadState('networkidle');

  const root = app.locator('[data-project-procurement-root]');
  for (const forbidden of [/new purchase order/i, /new goods receipt/i, /new bill/i, /new payment/i]) {
    await expect(root.getByRole('button', { name: forbidden })).toHaveCount(0);
    await expect(root.getByRole('link', { name: forbidden })).toHaveCount(0);
  }
});

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`procurement ${viewport.id} ${theme}`, async ({ app, page }) => {
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
      app.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
      });
      const failedRequests: string[] = [];
      app.on('response', (r) => {
        if (r.url().includes('/procurement') && r.status() >= 400) {
          failedRequests.push(`${r.status()} ${r.url()}`);
        }
      });

      const undersized: { view: string; text: string; w: number; h: number }[] = [];

      for (const projectId of [BUDGETED, UNBUDGETED]) {
        const label = projectId === BUDGETED ? 'budgeted' : 'unbudgeted';
        await app.goto(`/projects/${projectId}/procurement`);
        await app.getByRole('heading', { name: 'Procurement', exact: true, level: 2 }).waitFor();

        for (const view of VIEWS) {
          await app.getByRole('tab', { name: view }).click();
          await app.waitForLoadState('networkidle');
          await expect(app.locator('html')).toHaveAttribute('data-theme', theme);

          const metrics = await app.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          }));
          const controls = await measureControls(app);
          const under = viewport.id === 'mobile' ? controls.filter((c) => c.underH) : [];
          for (const c of under) undersized.push({ view: `${label}/${view}`, ...c });

          console.log(
            `[QA] ${viewport.id}-${theme} ${label}/${view} ` +
              `scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth} ` +
              `overflow=${metrics.scrollWidth > metrics.clientWidth + 1} ` +
              `controls=${controls.length} under44=${JSON.stringify(under)}`,
          );

          const slug = view.toLowerCase().replace(/[^a-z]+/g, '-');
          await app.screenshot({
            path: `${OUT}/${label}-${slug}-${viewport.id}-${theme}.png`,
            fullPage: true,
          });

          expect(
            metrics.scrollWidth,
            `page-level horizontal overflow at ${viewport.id}-${theme} ${label}/${view}`,
          ).toBeLessThanOrEqual(metrics.clientWidth + 1);
        }
      }

      console.log(
        `[QA] ${viewport.id}-${theme} consoleErrors=${JSON.stringify(consoleErrors)} ` +
          `failedApi=${JSON.stringify(failedRequests)}`,
      );
      expect(failedRequests, `Procurement API failures in ${viewport.id}-${theme}`).toEqual([]);
      expect(undersized, `Controls under 44px tall in ${viewport.id}-${theme}`).toEqual([]);
    });
  }
}
