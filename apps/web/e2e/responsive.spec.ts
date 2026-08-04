import {
  expect,
  expectNoHorizontalScroll,
  expectTouchTargets,
  scenario,
  switchTo,
  test,
} from './fixtures';

/**
 * Every screen at every viewport, in both languages.
 *
 * This is the check `apps/web/CLAUDE.md` has mandated all along and that browser QA could
 * never actually perform: Chrome on Windows refuses to size a window below roughly 500px,
 * so "works at 375px" was asserted from CSS and never once observed. Playwright sets the
 * viewport directly and the `mobile` project runs the whole file at 375×812.
 *
 * The rule under test is narrow and worth stating: wide content scrolls inside its own
 * container, and the document never scrolls sideways. The tables and tab strips here are
 * deliberately wider than a phone — the certificate table has six columns and the contract
 * tab strip has six tabs — so this is a real question, not a formality.
 */
const ROUTES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'projects', path: '/projects' },
  { name: 'clients', path: '/clients' },
  { name: 'contracts', path: '/contracts' },
  { name: 'receipts', path: '/receipts' },
  { name: 'new client', path: '/clients/new' },
  { name: 'new contract', path: '/contracts/new' },
  { name: 'new receipt', path: '/receipts/new' },
];

test.describe('layout', () => {
  for (const route of ROUTES) {
    test(`${route.name} does not scroll sideways`, async ({ app }) => {
      await app.goto(route.path);
      await app.getByRole('heading', { level: 1 }).waitFor();
      await expectNoHorizontalScroll(app);
    });
  }

  test('the client detail does not scroll sideways', async ({ app }) => {
    await app.goto(`/clients/${scenario.clientId}`);
    await app.getByRole('heading', { level: 1 }).waitFor();
    await expectNoHorizontalScroll(app);
  });

  // The widest surface in the app: six tabs over a six-column table of derived figures.
  test('the contract detail and its tabs do not scroll sideways', async ({ app }) => {
    await app.goto(`/contracts/${scenario.contractId}`);
    await app.getByRole('heading', { level: 1 }).waitFor();
    await expectNoHorizontalScroll(app);

    for (const tab of ['Retention', 'Advances', 'Guarantees', 'Milestones', 'Applications']) {
      await app.getByRole('tab', { name: tab }).click();
      await expectNoHorizontalScroll(app);
    }
  });

  test('the application detail does not scroll sideways', async ({ app }) => {
    await app.goto(`/contracts/${scenario.contractId}/applications/${scenario.ipaId}`);
    await app.getByRole('heading', { level: 1 }).waitFor();
    await expectNoHorizontalScroll(app);
  });

  test('the receipt detail does not scroll sideways', async ({ app }) => {
    await app.goto(`/receipts/${scenario.receiptId}`);
    await app.getByRole('heading', { level: 1 }).waitFor();
    await expectNoHorizontalScroll(app);
  });

  // Money in four places — header, summary, settlement, then a line per certified item —
  // and a variance reason that is free text of any length.
  test('the certificate detail does not scroll sideways', async ({ app }) => {
    await app.goto(
      `/contracts/${scenario.contractId}/applications/${scenario.ipaId}/certificates/${scenario.ipcId}`,
    );
    await app.getByRole('heading', { level: 1 }).waitFor();
    await expectNoHorizontalScroll(app);
  });

  // The claimed-lines table is genuinely wider than 375px. It must scroll INSIDE its
  // container — that is what TableScroll is for — while the page stays put.
  test('a wide table scrolls inside its own container', async ({ app }) => {
    await app.goto(`/contracts/${scenario.contractId}/applications/${scenario.ipaId}`);

    const region = app.getByRole('region', { name: 'Claimed lines' });
    await region.waitFor();

    const scrolls = await region.evaluate((el) => el.scrollWidth > el.clientWidth);
    const viewport = app.viewportSize();

    // At 375px the table must overflow its container; at 1440px it need not. Either way
    // the document itself stays put, which the assertion below is really about.
    if (viewport && viewport.width < 700) {
      expect(scrolls, 'the claimed-lines table should scroll within its container at 375px').toBe(
        true,
      );
    }
    await expectNoHorizontalScroll(app);
  });

  test('right-to-left does not introduce sideways scroll', async ({ app }) => {
    await app.goto('/contracts');
    await switchTo(app, 'ar');

    for (const path of ['/contracts', '/receipts', `/contracts/${scenario.contractId}`]) {
      await app.goto(path);
      await app.getByRole('heading', { level: 1 }).waitFor();
      await expectNoHorizontalScroll(app);
    }

    await switchTo(app, 'en');
  });
});

test.describe('touch targets', () => {
  // Only meaningful on the narrow project — the rule exists for thumbs.
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 700, 'mobile viewport only');

  for (const path of ['/clients', '/contracts', '/receipts', '/clients/new']) {
    test(`controls on ${path} are at least 44px tall`, async ({ app }) => {
      await app.goto(path);
      await app.getByRole('heading', { level: 1 }).waitFor();
      await expectTouchTargets(app);
    });
  }

  // The certificate row on the application detail is a link wrapping a whole row, which is
  // the shape that was wrong across every list until c8afdd6 — a link only as tall as its
  // text, inside a taller row. Worth holding to the rule where it was most recently broken.
  test('the certificate row on an application is a full-height target', async ({ app }) => {
    await app.goto(`/contracts/${scenario.contractId}/applications/${scenario.ipaId}`);
    await app.getByRole('heading', { level: 1 }).waitFor();
    await expectTouchTargets(app);
  });

  test('controls on the certificate detail are at least 44px tall', async ({ app }) => {
    await app.goto(
      `/contracts/${scenario.contractId}/applications/${scenario.ipaId}/certificates/${scenario.ipcId}`,
    );
    await app.getByRole('heading', { level: 1 }).waitFor();
    await expectTouchTargets(app);
  });
});
