import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { test as base, expect, type Page } from '@playwright/test';

import { signIn } from './fixtures';

/**
 * Browser acceptance gate for the project Finance workspace and its charts (Phase 6).
 *
 *   E2E_SKIP_SEED=1 RUKNA_DEMO_PASSWORD=… QA_FINANCE_PROJECT_ID=… QA_STARTED_PROJECT_ID=… \
 *     pnpm --filter @erp/web exec playwright test project-finance-qa --project=desktop
 *
 * Two things need a real browser here and nothing else can reach them.
 *
 * **Colour resolves at runtime.** A component test sees `var(--color-series-2)` and can only
 * check that the string is right. Whether that token resolves to a *different* colour from its
 * neighbour, on the surface it is actually drawn against, in the theme the reader has chosen, is
 * a question only a browser answers. The defect this suite was written after — a sequential ramp
 * cycled across unordered categories — was invisible to every unit test that touched it.
 *
 * **375px is unverifiable any other way.** Chrome on Windows will not size a window below its
 * minimum, so a stacked bar's slivers, a legend's wrap and a meter's labels all had to be taken
 * on faith. Playwright sets the viewport directly.
 *
 * The ratio matrix is driven through `page.route`, deliberately. 99% and "revenue is zero while
 * cost is not" are boundary values; hitting them by posting journals would take a dozen writes to
 * a shared dev database and still land on whatever the arithmetic happened to give. Mocking the
 * response puts the exact number into the real component at the real viewport, which is what
 * these checks are about. Everything that is not a boundary value runs on real data.
 */

/** A project with a baselined cost budget and real committed cost — the charts run on this. */
const FINANCE = process.env['QA_FINANCE_PROJECT_ID'] ?? '';
/**
 * A project that has started and has nothing posted.
 *
 * Two jobs. Unmocked it is the genuine empty state, and mocked it hosts the ratio matrix —
 * which needs a *started* project, because the P&L view refuses to report on one whose start
 * date is in the future and returns before any request is made.
 */
const STARTED = process.env['QA_STARTED_PROJECT_ID'] ?? '';
const OUT = resolve(process.cwd(), 'e2e/.artifacts/project-finance-qa');
mkdirSync(OUT, { recursive: true });

const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await signIn(page);
    await use(page);
  },
});

/** The validated categorical set, as it resolves in each theme. */
const SERIES = {
  light: [
    'rgb(42, 120, 214)',
    'rgb(235, 104, 52)',
    'rgb(27, 175, 122)',
    'rgb(237, 161, 0)',
    'rgb(232, 123, 164)',
  ],
  dark: [
    'rgb(57, 135, 229)',
    'rgb(217, 89, 38)',
    'rgb(25, 158, 112)',
    'rgb(201, 133, 0)',
    'rgb(213, 81, 129)',
  ],
} as const;

const CASES = [
  { id: 'desktop-dark', width: 1440, height: 900, theme: 'dark' },
  { id: 'mobile-light', width: 375, height: 812, theme: 'light' },
  { id: 'mobile-dark', width: 375, height: 812, theme: 'dark' },
] as const;

async function useTheme(app: Page, theme: string, width: number, height: number) {
  await app.setViewportSize({ width, height });
  await app.addInitScript((value) => {
    try {
      localStorage.setItem('rukna.theme.preference', value as string);
    } catch {
      /* private mode */
    }
  }, theme);
}

/**
 * Waits for a finance view to be the current one.
 *
 * Not on a heading: the four views do not name themselves consistently. Profit & Loss and
 * Ledger open with an `h2` carrying the view name; Cost Control opens with a panel titled
 * "Cost Control" at `h3`; Overview has no heading of its own at all, only the shell's `h1`.
 * That inconsistency is a real finding and is reported as one, but a QA suite for charts
 * should not be the thing that trips over it — so the anchor is the nav link the shell marks
 * `aria-current="page"`, which every view has and only the current one carries.
 */
async function showView(app: Page, name: string) {
  await app
    .locator('nav[aria-label="Finance"] a[aria-current="page"]')
    .filter({ hasText: name })
    .waitFor();
  await app.waitForLoadState('networkidle');
}

async function expectNoPageOverflow(app: Page, where: string) {
  const overflow = await app.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `${where}: ${overflow.scrollWidth}px of content in ${overflow.clientWidth}px`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/** Geometry and colour of every stacked-bar segment currently on screen. */
async function segments(app: Page) {
  return app.evaluate(() => {
    const out: { label: string; width: number; colour: string }[] = [];
    for (const bar of document.querySelectorAll('[role="img"]')) {
      for (const seg of bar.querySelectorAll(':scope > span')) {
        const rect = seg.getBoundingClientRect();
        out.push({
          label: seg.getAttribute('title') ?? '',
          width: Math.round(rect.width * 10) / 10,
          colour: getComputedStyle(seg).backgroundColor,
        });
      }
    }
    return out;
  });
}

test.skip(!FINANCE || !STARTED, 'Set QA_FINANCE_PROJECT_ID and QA_STARTED_PROJECT_ID');

// ── Real data ────────────────────────────────────────────────────────────────

for (const view of CASES) {
  test(`finance workspace renders on real data — ${view.id}`, async ({ app }) => {
    test.slow();
    await useTheme(app, view.theme, view.width, view.height);

    const consoleErrors: string[] = [];
    app.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });

    for (const [slug, heading] of [
      ['', 'Overview'],
      ['/cost-control', 'Cost Control'],
      ['/profit-loss', 'Profit & Loss'],
      ['/ledger', 'Ledger'],
    ] as const) {
      await app.goto(`/projects/${FINANCE}/finance${slug}`);
      await showView(app, heading);
      await expect(app.locator('html')).toHaveAttribute('data-theme', view.theme);

      await expectNoPageOverflow(app, `${view.id} ${heading}`);
      await app.screenshot({
        path: `${OUT}/real-${heading.toLowerCase().replace(/[^a-z]+/g, '-')}-${view.id}.png`,
        fullPage: true,
      });
    }

    expect(consoleErrors, `console errors in ${view.id}`).toEqual([]);
  });
}

/**
 * No segment collapses to an invisible sliver, and every one of them is named and valued
 * regardless of its colour.
 */
test('every stacked-bar segment is hittable and carries its identity in text', async ({ app }) => {
  await useTheme(app, 'light', 375, 812);
  await app.goto(`/projects/${FINANCE}/finance/cost-control`);
  await showView(app, 'Cost Control');

  const drawn = await segments(app);
  expect(drawn.length, 'no stacked bar rendered on the budget composition').toBeGreaterThan(0);

  for (const segment of drawn) {
    // `min-w-1` is the floor: a 0.4% slice is still a visible mark rather than a hairline.
    expect(
      segment.width,
      `sliver: ${segment.label} at ${segment.width}px`,
    ).toBeGreaterThanOrEqual(4);
    // The bar's own tooltip carries label, money and percent — identity never rests on colour.
    expect(segment.label).toMatch(/\(\d/);
  }
});

/**
 * The regression guard for the defect that started this: categorical marks must draw from the
 * categorical set, never from the sequential cost-stage ramp.
 */
for (const theme of ['light', 'dark'] as const) {
  test(`categorical marks use the series palette, not the cost-stage ramp — ${theme}`, async ({
    app,
  }) => {
    await useTheme(app, theme, 1440, 900);
    await app.goto(`/projects/${FINANCE}/finance/cost-control`);
    await showView(app, 'Cost Control');

    const drawn = await segments(app);
    expect(drawn.length).toBeGreaterThan(0);
    const colours = drawn.map((s) => s.colour);

    for (const colour of colours) {
      expect(
        SERIES[theme] as readonly string[],
        `${colour} is not in the validated series set`,
      ).toContain(colour);
    }
    // Adjacent segments must never share a fill.
    for (let i = 1; i < colours.length; i += 1) {
      expect(colours[i], 'adjacent segments share a colour').not.toBe(colours[i - 1]);
    }
  });
}

// ── The ratio matrix ─────────────────────────────────────────────────────────

interface PlLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountClass: string;
  accountSubtype: string;
  amount: string;
}

function pl(revenue: string, costOfSales: string, expenses: string) {
  const line = (id: string, code: string, name: string, amount: string): PlLine => ({
    accountId: id,
    accountCode: code,
    accountName: name,
    accountClass: id.startsWith('r') ? 'REVENUE' : 'EXPENSE',
    accountSubtype: id.startsWith('r') ? 'OPERATING_REVENUE' : 'DIRECT_COST',
    amount,
  });

  return {
    fromDate: '2026-01-01',
    toDate: '2026-09-06',
    organizationId: 'org',
    projectId: STARTED,
    generatedAt: '2026-09-06T00:00:00.000Z',
    revenue: {
      label: 'Revenue',
      total: revenue,
      lines: Number(revenue) > 0 ? [line('r1', '40100', 'Contract revenue', revenue)] : [],
    },
    costOfSales: {
      label: 'Cost of sales',
      total: costOfSales,
      lines:
        Number(costOfSales) > 0
          ? [line('c1', '50100', 'Subcontractor cost', costOfSales)]
          : ([] as PlLine[]),
    },
    grossProfit: (Number(revenue) - Number(costOfSales)).toFixed(2),
    expenses: {
      label: 'Operating expenses',
      total: expenses,
      lines:
        Number(expenses) > 0
          ? [line('e1', '60100', 'Site establishment', expenses)]
          : ([] as PlLine[]),
    },
    netIncome: (Number(revenue) - Number(costOfSales) - Number(expenses)).toFixed(2),
  };
}

async function mockPl(app: Page, body: unknown) {
  await app.route('**/projects/*/pl*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  );
}

/** The meter's labels stay readable across the whole range, at every viewport. */
const RATIOS = [
  { name: '0pct', revenue: '100000.00', cost: '0.00', percent: '0' },
  { name: '50pct', revenue: '100000.00', cost: '50000.00', percent: '50' },
  { name: '99pct', revenue: '100000.00', cost: '99000.00', percent: '99' },
  { name: '100pct', revenue: '100000.00', cost: '100000.00', percent: '100' },
  { name: 'over100pct', revenue: '100000.00', cost: '125000.00', percent: '125' },
] as const;

for (const view of CASES) {
  for (const ratio of RATIOS) {
    test(`meter reads ${ratio.percent}% — ${view.id}`, async ({ app }) => {
      await useTheme(app, view.theme, view.width, view.height);
      await mockPl(app, pl(ratio.revenue, ratio.cost, '0.00'));

      await app.goto(`/projects/${STARTED}/finance/profit-loss`);
      await showView(app, 'Profit & Loss');

      const meter = app.getByRole('progressbar', { name: 'Project cost / Revenue' });
      await expect(meter).toHaveAttribute('aria-valuenow', ratio.percent);
      await expect(app.getByText(`${ratio.percent}%`).first()).toBeVisible();

      // The figures that let a reader check the division are on screen as text.
      await expect(app.getByText('Revenue (posted)')).toBeVisible();
      await expect(app.getByText('Project cost (posted)')).toBeVisible();

      await expectNoPageOverflow(app, `${view.id} meter ${ratio.name}`);
      await app.screenshot({ path: `${OUT}/meter-${ratio.name}-${view.id}.png`, fullPage: true });
    });
  }

  /** The state the meter exists to refuse: `cost / 0` is undefined, so no ratio is drawn. */
  test(`meter reports no ratio when revenue is zero and cost is not — ${view.id}`, async ({
    app,
  }) => {
    await useTheme(app, view.theme, view.width, view.height);
    await mockPl(app, pl('0.00', '45000.00', '0.00'));

    await app.goto(`/projects/${STARTED}/finance/profit-loss`);
    await showView(app, 'Profit & Loss');

    await expect(app.getByText(/No revenue posted for this project/)).toBeVisible();
    await expect(app.getByRole('progressbar', { name: 'Project cost / Revenue' })).toHaveCount(0);

    // Scoped to the meter's own figure. The panel below it — the cost breakdown — legitimately
    // reads "100%" when a single account carries all the cost, and that is a different chart
    // answering a different question.
    const figure = (
      await app.locator('figure').filter({ hasText: 'Project cost / Revenue' }).innerText()
    ).replace(/\s+/g, ' ');
    expect(figure, 'a fabricated ratio appeared').not.toMatch(/∞|Infinity|NaN/);
    expect(figure, 'the undefined ratio was rendered as a percentage').not.toMatch(/\d%/);
    // The cost is still reported: it is a fact even without a denominator.
    expect(figure).toMatch(/45,000/);

    await expectNoPageOverflow(app, `${view.id} meter no-revenue`);
    await app.screenshot({ path: `${OUT}/meter-no-revenue-${view.id}.png`, fullPage: true });
  });
}

/** Nothing posted at all is an empty state, not a meter at zero. Runs on real data. */
test('an unposted project shows an empty state rather than a chart of zero', async ({ app }) => {
  await useTheme(app, 'dark', 1440, 900);
  await app.goto(`/projects/${STARTED}/finance/profit-loss`);
  await showView(app, 'Profit & Loss');

  await expect(app.getByRole('progressbar')).toHaveCount(0);
  const body = (await app.locator('main').innerText()).replace(/\s+/g, ' ');
  expect(body).toMatch(/Nothing has been posted|Nothing posted/);
  await app.screenshot({ path: `${OUT}/pl-empty-desktop-dark.png`, fullPage: true });
});

/**
 * Long names, driven to the limit: nine cost accounts with names longer than any panel. Five
 * identities are drawn and the tail folds; the legend wraps instead of pushing the chart
 * sideways; and no label escapes its row.
 */
for (const view of CASES) {
  test(`long category names fold and wrap rather than overflow — ${view.id}`, async ({ app }) => {
    await useTheme(app, view.theme, view.width, view.height);

    const long: [string, string][] = [
      ['Subcontractor cost — structural steel erection and fixing', '180000.00'],
      ['Subcontractor cost — reinforced concrete substructure works', '150000.00'],
      ['Materials — imported finishing and joinery packages', '120000.00'],
      ['Plant and equipment hire — tower crane and hoists', '90000.00'],
      ['Site establishment, accommodation and welfare facilities', '60000.00'],
      ['Professional fees — structural and services consultants', '40000.00'],
      ['Temporary works design and falsework', '25000.00'],
      ['Insurances, bonds and statutory permits', '15000.00'],
      ['Site cleaning and waste removal', '9000.00'],
    ];

    const body = pl('900000.00', '0.00', '0.00');
    body.costOfSales = {
      label: 'Cost of sales',
      total: '689000.00',
      lines: long.map(([name, amount], i) => ({
        accountId: `c${i}`,
        accountCode: `5${100 + i}`,
        accountName: name,
        accountClass: 'EXPENSE',
        accountSubtype: 'DIRECT_COST',
        amount,
      })),
    };
    body.grossProfit = '211000.00';
    body.netIncome = '211000.00';
    await mockPl(app, body);

    await app.goto(`/projects/${STARTED}/finance/profit-loss`);
    await showView(app, 'Profit & Loss');

    // Nine accounts, five identities: the tail folds rather than the palette growing.
    await expect(app.getByText('Other', { exact: true }).first()).toBeVisible();
    const drawn = await segments(app);
    const breakdown = drawn.filter((s) =>
      (SERIES[view.theme] as readonly string[]).includes(s.colour),
    );
    expect(breakdown.length, 'more than five categorical identities drawn').toBeLessThanOrEqual(5);
    expect(new Set(breakdown.map((s) => s.colour)).size).toBe(breakdown.length);

    await expectNoPageOverflow(app, `${view.id} long labels`);

    // No legend row spills past its own container.
    const spill = await app.evaluate(() => {
      const bad: string[] = [];
      for (const li of document.querySelectorAll('figure li')) {
        const parent = li.parentElement!.getBoundingClientRect();
        const rect = li.getBoundingClientRect();
        if (rect.right > parent.right + 1 || rect.left < parent.left - 1) {
          bad.push((li.textContent ?? '').trim().slice(0, 50));
        }
      }
      return bad;
    });
    expect(spill, 'legend rows overflow their container').toEqual([]);

    await app.screenshot({ path: `${OUT}/long-labels-${view.id}.png`, fullPage: true });
  });
}
