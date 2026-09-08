import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { test as base, expect, type Page } from '@playwright/test';

import { expectNoHorizontalScroll, expectTouchTargets, signIn } from './fixtures';

/**
 * Browser acceptance gate for the Administration workspace (ADR-028).
 *
 * Run manually against a live API:
 *   E2E_SKIP_SEED=1 RUKNA_DEMO_PASSWORD=<admin pw> \
 *     pnpm --filter @erp/web exec playwright test admin-workspace-qa
 *
 * Administration moved from a collapsible column of six sidebar rows to a workspace with a tab
 * bar. Three of the things that move can only be proven in a browser: that the sidebar really
 * lost its second level, that the tab bar becomes a reachable picker at 375px rather than
 * scrolling its later tabs into the void, and that the header no longer says the same thing
 * three times. Everything here is measured off the DOM — `getBoundingClientRect` and the
 * accessibility tree — rather than eyeballed from a screenshot.
 */

const OUT = resolve(process.cwd(), 'e2e/.artifacts/admin-qa');
mkdirSync(OUT, { recursive: true });

const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await signIn(page);
    await use(page);
  },
});

/** Light and dark are both first-class and both must pass. */
const THEMES = ['light', 'dark'] as const;

/** Declared IA order — the order `nav-groups.ts` fixes and the reader perceives. */
const TABS = [
  { label: 'Users', slug: 'users' },
  { label: 'Roles', slug: 'roles' },
  { label: 'Districts', slug: 'districts' },
  { label: 'Project subtypes', slug: 'project-subtypes' },
  { label: 'Workflows', slug: 'workflows' },
  { label: 'Audit logs', slug: 'audit-logs' },
] as const;

const NAV_LABEL = 'Administration sections';

async function useTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript((value) => {
    localStorage.setItem('rukna.theme.preference', value as string);
  }, theme);
}

/** Collects console errors and failed requests — a real server tells the truth. */
function watchForFailures(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
  });
  return problems;
}

test.describe('Administration workspace', () => {
  test('says where you are once, and only once', async ({ app }) => {
    await app.goto('/admin/users');

    // The h1 is the workspace, not the screen. That is what lets each screen be an h2.
    await expect(app.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible();
    expect(await app.getByRole('heading', { level: 1 }).count()).toBe(1);

    // The screen names itself one level down.
    await expect(app.getByRole('heading', { level: 2, name: 'Users' })).toBeVisible();

    // No breadcrumb restating the sidebar row, the h1 and the lit tab.
    await expect(app.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);

    // And no fixed subtitle repeated on all six screens.
    await expect(app.getByText('Manage your organization, people')).toHaveCount(0);
  });

  test('draws the six screens as one tab row, in IA order', async ({ app }) => {
    await app.goto('/admin/users');

    const tabs = app.getByRole('navigation', { name: NAV_LABEL }).getByRole('link');
    await expect(tabs).toHaveText(TABS.map((tab) => tab.label));
  });

  test('moves the lit tab as you navigate, and keeps the workspace heading', async ({ app }) => {
    await app.goto('/admin/users');
    const nav = app.getByRole('navigation', { name: NAV_LABEL });

    for (const target of ['Roles', 'Workflows', 'Audit logs']) {
      await nav.getByRole('link', { name: target }).click();
      await expect(app.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible();

      const current = nav.locator('a[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText(target);
    }
  });

  test('leaves one Administration row in the sidebar, with no second level', async ({ app }) => {
    await app.goto('/admin/users');

    const adminLinks = app.locator('aside a[href^="/admin"], nav a[href^="/admin"]');
    const hrefs = await adminLinks.evaluateAll((nodes) =>
      nodes
        .filter((node) => !node.closest('[aria-label="Administration sections"]'))
        .map((node) => node.getAttribute('href')),
    );

    // One row — the domain itself. The six children are the workspace's tabs now.
    expect(hrefs, `sidebar admin links: ${JSON.stringify(hrefs)}`).toEqual(['/admin']);

    // It stays lit on a route beneath it, because nothing else in the sidebar says so.
    await app.goto('/admin/audit-logs');
    await expect(app.locator('a[href="/admin"][aria-current="page"]')).toHaveCount(1);
  });

  test('gets out of the way on the governance builder, which brings its own chrome', async ({
    app,
  }) => {
    await app.goto('/admin/workflows');

    const policyLink = app.locator('a[href^="/admin/workflows/"]').first();
    if ((await policyLink.count()) === 0) {
      test.skip(true, 'no approval policy in this database to open the builder with');
      return;
    }

    await policyLink.click();
    await expect(app.getByRole('navigation', { name: NAV_LABEL })).toHaveCount(0);
  });

  for (const theme of THEMES) {
    test(`holds together at 1440 in ${theme}`, async ({ app }) => {
      const problems = watchForFailures(app);
      await useTheme(app, theme);
      await app.setViewportSize({ width: 1440, height: 900 });

      for (const tab of TABS) {
        await app.goto(`/admin/${tab.slug}`);
        await expect(app.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible();
        await expect(app.locator('html')).toHaveAttribute('data-theme', theme);
        await expectNoHorizontalScroll(app);
        await app.screenshot({ path: `${OUT}/desktop-${theme}-${tab.slug}.png` });
      }

      expect(problems, problems.join('\n')).toEqual([]);
    });

    test(`becomes a reachable picker at 375 in ${theme}`, async ({ app }) => {
      await useTheme(app, theme);
      await app.setViewportSize({ width: 375, height: 812 });
      await app.goto('/admin/users');

      const nav = app.getByRole('navigation', { name: NAV_LABEL });

      // The desktop row is gone at this width…
      await expect(nav.getByRole('link', { name: 'Users' })).toBeHidden();

      // …and the picker that replaces it names the screen you are on.
      const picker = nav.getByRole('combobox', { name: NAV_LABEL });
      await expect(picker).toBeVisible();
      await expect(picker).toContainText('Users');

      // Every destination is reachable from it — including the ones a scrolling row would
      // have hidden past the right edge.
      await picker.click();
      const lastTab = app.getByRole('option', { name: 'Audit logs' });
      await expect(lastTab).toBeVisible();
      await lastTab.click();
      await expect(app).toHaveURL(/\/admin\/audit-logs$/);
      await expect(nav.getByRole('combobox', { name: NAV_LABEL })).toContainText('Audit logs');

      await expectNoHorizontalScroll(app);
      await expectTouchTargets(app);
      await app.screenshot({ path: `${OUT}/mobile-${theme}-audit-logs.png`, fullPage: true });
    });
  }
});
