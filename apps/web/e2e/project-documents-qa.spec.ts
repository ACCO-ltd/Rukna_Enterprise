import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { test as base, expect, type Page } from '@playwright/test';

import { signIn } from './fixtures';

/**
 * Browser acceptance gate for the project Documents workspace (Phase 7A).
 *
 *   E2E_SKIP_SEED=1 RUKNA_DEMO_PASSWORD=… QA_DOCUMENTS_PROJECT_ID=… \
 *     pnpm --filter @erp/web exec playwright test project-documents-qa --project=desktop
 *
 * Three things need a real browser and nothing else reaches them.
 *
 * **The register is a wide table and 375px is where it breaks.** `apps/web/CLAUDE.md` mandates
 * that every screen work at 375px, and a nine-column register is the hardest case in the product
 * so far. The horizontal-overflow assertion is the whole point: the table must scroll inside its
 * own container while the *page* does not, which no component test can observe.
 *
 * **The lifecycle is a sequence, not a state.** Register → issue → new revision → issue again is
 * four writes across three screens, and the invariant that matters — exactly one current revision,
 * with the previous one still readable — only exists across all four. A mocked test asserts the
 * shape of one response; this asserts the shape of the history.
 *
 * **Immutability has to actually hold.** After a revision is issued, the affordance to replace its
 * file must be gone AND the server must refuse. Both halves are checked, because a UI that hides
 * a button over an API that would have allowed the call is not a control.
 *
 * The full write path (register → issue → revise) runs only when
 * `QA_DOCUMENTS_WRITE=1`, because it leaves real rows on the shared dev tenant. The read,
 * responsive and empty-state cases run unconditionally.
 */

const PROJECT = process.env['QA_DOCUMENTS_PROJECT_ID'] ?? '';
const RUN_WRITES = process.env['QA_DOCUMENTS_WRITE'] === '1';
const OUT = resolve(process.cwd(), 'e2e/.artifacts/project-documents-qa');
mkdirSync(OUT, { recursive: true });

const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await signIn(page);
    await use(page);
  },
});

const CASES = [
  { id: 'desktop-light', width: 1440, height: 900, theme: 'light' },
  { id: 'desktop-dark', width: 1440, height: 900, theme: 'dark' },
  { id: 'mobile-light', width: 375, height: 812, theme: 'light' },
  { id: 'mobile-dark', width: 375, height: 812, theme: 'dark' },
] as const;

async function useTheme(app: Page, theme: string, width: number, height: number) {
  await app.setViewportSize({ width, height });
  await app.addInitScript((value) => {
    try {
      window.localStorage.setItem('erp-theme', value as string);
    } catch {
      /* private mode — the class below is what actually decides */
    }
  }, theme);
  await app.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
}

/** The register's own nav, which is a link list rather than a tablist. */
async function gotoRegister(app: Page) {
  await app.goto(`/projects/${PROJECT}/documents`);
  await expect(app.getByRole('heading', { name: 'Documents', level: 1 })).toBeVisible();
}

async function gotoAttachments(app: Page) {
  await app.goto(`/projects/${PROJECT}/documents/attachments`);
  await expect(app.getByRole('heading', { name: 'Linked Attachments' })).toBeVisible();
}

/**
 * The 375px contract, asserted the way the Finance gate asserts it.
 *
 * `scrollWidth === clientWidth` on the document element: wide content scrolls inside its own
 * container, the page never does. A one-pixel tolerance because sub-pixel layout rounding is not
 * a defect.
 */
async function expectNoPageOverflow(app: Page) {
  const overflow = await app.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/**
 * Every interactive control in the Documents workspace must clear 44px (CLAUDE.md mobile rules).
 *
 * Scoped to `[data-qa="documents-workspace"]`, deliberately. The first run of this scanned the
 * whole document and failed on eight controls that all belonged to the app shell — the skip link,
 * the sidebar toggles, the breadcrumb links — plus the dev-only TanStack devtools button. That is
 * a real finding and it is recorded as shell debt, but it is not this workspace's, and a gate that
 * fails on someone else's debt gets disabled rather than fixed.
 */
async function expectTouchTargets(app: Page) {
  const undersized = await app.evaluate(() => {
    const root = document.querySelector('[data-qa="documents-workspace"]');
    if (!root) throw new Error('Documents workspace root not found');
    const selectors = 'button, a[href], [role="button"], input, select, textarea';
    return [...root.querySelectorAll(selectors)]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        return rect.height < 44;
      })
      .map((el) => `${el.tagName}.${(el.className || '').toString().slice(0, 40)}`);
  });
  expect(undersized).toEqual([]);
}

test.beforeAll(() => {
  if (!PROJECT) {
    throw new Error('QA_DOCUMENTS_PROJECT_ID is required — the suite navigates a real project.');
  }
});

for (const variant of CASES) {
  test.describe(`Documents · ${variant.id}`, () => {
    test.beforeEach(async ({ app }) => {
      await useTheme(app, variant.theme, variant.width, variant.height);
    });

    test('register renders with its two views and no page-level horizontal overflow', async ({
      app,
    }) => {
      await gotoRegister(app);
      await expect(app.getByRole('link', { name: 'Register' })).toBeVisible();
      await expect(app.getByRole('link', { name: 'Linked Attachments' })).toBeVisible();
      await expectNoPageOverflow(app);
      await app.screenshot({ path: `${OUT}/register-${variant.id}.png`, fullPage: true });
    });

    test('the summary band states the expiry threshold rather than implying one', async ({
      app,
    }) => {
      await gotoRegister(app);
      // Present whenever the register has loaded — the count may be zero, the threshold is not.
      // `.first()` because the label appears both in the summary band and as a filter option.
      await expect(app.getByText('Controlled documents').first()).toBeVisible();
      await expect(app.getByText(/Within \d+ days/)).toBeVisible();
    });

    test('linked attachments offers no attach or delete — it is a read model', async ({ app }) => {
      await gotoAttachments(app);
      await expect(app.getByRole('button', { name: /^attach/i })).toHaveCount(0);
      await expect(app.getByRole('button', { name: /^(delete|remove)/i })).toHaveCount(0);
      await expectNoPageOverflow(app);
      await app.screenshot({ path: `${OUT}/attachments-${variant.id}.png`, fullPage: true });
    });

    test('no unexpected console errors or failed requests on either view', async ({ app }) => {
      const errors: string[] = [];
      const failures: string[] = [];
      app.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      app.on('response', (response) => {
        if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
      });

      await gotoRegister(app);
      await gotoAttachments(app);
      await app.waitForTimeout(500);

      // React DevTools nags and browser-extension noise are not the application's output.
      const real = errors.filter((text) => !/DevTools|Download the React/i.test(text));
      expect(real).toEqual([]);
      expect(failures).toEqual([]);
    });

    if (variant.width === 375) {
      test('every control clears 44px at 375px', async ({ app }) => {
        await gotoRegister(app);
        await expectTouchTargets(app);
        await gotoAttachments(app);
        await expectTouchTargets(app);
      });

      test('filters collapse behind a toggle rather than pushing the table off-screen', async ({
        app,
      }) => {
        await gotoRegister(app);
        const toggle = app.getByRole('button', { name: 'Filters' });
        await expect(toggle).toBeVisible();
        await toggle.click();
        await expect(app.getByLabel('Category')).toBeVisible();
        await expectNoPageOverflow(app);
      });
    }
  });
}

/**
 * The lifecycle, walked once at desktop.
 *
 * Everything before this point is a rendering claim. This is the only place the *invariant* is
 * tested: after two issues there is exactly one current revision, the superseded one is still
 * listed and still openable, and the issued file cannot be replaced.
 */
// Serial here and only here: register → issue → revise → issue is one sequence, and each step
// depends on the last. The rendering variants above are independent and must not abort each other.
test.describe.configure({ mode: 'serial' });

test.describe('Documents · controlled lifecycle', () => {
  test.skip(!RUN_WRITES, 'Set QA_DOCUMENTS_WRITE=1 — this leaves real rows on the dev tenant.');

  const stamp = Date.now();
  const documentNumber = `QA-DOC-${stamp}`;

  test('register → issue → revise → issue keeps one current revision and one history', async ({
    page,
  }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoRegister(page);

    // --- register -------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Register document' }).first().click();
    await page.getByLabel('Document number').fill(documentNumber);
    await page.getByLabel('Title').fill('QA slab reinforcement');
    await page.getByLabel('Revision code').fill('R00');
    await page
      .locator('#doc-file')
      .setInputFiles({ name: 'r00.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 r00') });
    await page.getByRole('button', { name: 'Register document' }).last().click();

    // Straight to the detail page, which is where the next act lives.
    await page.waitForURL(/\/documents\/[^/]+$/);
    await expect(page.getByRole('heading', { name: 'QA slab reinforcement' })).toBeVisible();
    // Uploading is not issuance: the record is a draft.
    await expect(page.getByText('Draft').first()).toBeVisible();

    // --- issue R00 ------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Issue revision' }).click();
    await page.getByRole('button', { name: 'Issue revision' }).last().click();
    await expect(page.getByText('Issued').first()).toBeVisible();
    await expect(page.getByText(/cannot be replaced/i)).toBeVisible();

    // --- revise ---------------------------------------------------------------------------
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Create revision' }).click();
    await page.getByLabel('Revision code').fill('R01');
    await page
      .locator('#rev-file')
      .setInputFiles({ name: 'r01.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 r01') });
    await page.getByRole('button', { name: 'Create revision' }).last().click();
    await expect(page.getByRole('cell', { name: /R01/ })).toBeVisible();

    // --- issue R01 ------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Issue revision' }).click();
    await page.getByRole('button', { name: 'Issue revision' }).last().click();

    // The invariant: one current, one superseded, both still listed.
    //
    // Scoped to the history table's BODY and exact-matched. Two collisions to get past: "Current"
    // as a substring also hits the "Current revision" panel heading, and "Superseded" is a column
    // header as well as a status. Both are different things from the row values being counted.
    const history = page.locator('tbody');
    await expect(history.getByText('Current', { exact: true })).toHaveCount(1);
    await expect(history.getByText('Superseded', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'r00.pdf' })).toBeVisible();
    await page.screenshot({ path: `${OUT}/lifecycle-history.png`, fullPage: true });
  });

  /**
   * The other half of immutability: the SERVER refuses, not just the UI.
   *
   * Driven through Playwright's request context rather than a page-context `fetch`, because the
   * access token lives in memory by design (`apps/web/CLAUDE.md`) — there is no cookie to ride,
   * so a fetch from the page is unauthenticated and would 401 for the wrong reason. This signs in
   * against the API directly and calls the route the hidden button would have called.
   */
  test('the server refuses to replace an issued file, not just the UI', async ({ request }) => {
    // Plain `localhost` with an explicit Host header, not `acco.localhost`. Node cannot resolve
    // arbitrary `*.localhost` subdomains — the same limitation the seed script and the readiness
    // probe already work around — while the API resolves its tenant from the Host header, so this
    // reaches the acco tenant without needing DNS to cooperate.
    const api = process.env['E2E_API_URL'] ?? 'http://localhost:3001/api/v1';
    const auth = { Host: 'acco.localhost' } as Record<string, string>;
    const login = await request.post(`${api}/auth/login`, {
      headers: auth,
      data: { email: 'admin@acco.com', password: process.env['RUKNA_DEMO_PASSWORD'] },
    });
    expect(login.ok()).toBe(true);
    const { accessToken } = (await login.json()) as { accessToken: string };
    auth['Authorization'] = `Bearer ${accessToken}`;

    const list = await request.get(
      `${api}/projects/${PROJECT}/documents?search=${documentNumber}`,
      { headers: auth },
    );
    const page = (await list.json()) as { items: { id: string }[] };
    const documentId = page.items[0]?.id;
    expect(documentId, 'the lifecycle test should have registered this document').toBeTruthy();

    const detail = await request.get(`${api}/projects/${PROJECT}/documents/${documentId}`, {
      headers: auth,
    });
    const { revisions } = (await detail.json()) as {
      revisions: { id: string; status: string }[];
    };
    const issued = revisions.find((revision) => revision.status === 'ISSUED');
    expect(issued, 'an issued revision should exist after the lifecycle walk').toBeTruthy();

    const refused = await request.patch(
      `${api}/projects/${PROJECT}/documents/${documentId}/revisions/${issued!.id}/file`,
      { headers: auth, data: { platformFileId: 'does-not-matter' } },
    );
    // 403 from the lifecycle guard. Never 200, and never 404 — a 404 would mean the route moved
    // and the guard was never reached, which reads like a pass and is not one.
    expect(refused.status()).toBe(403);

    // And the discard route is refused on an issued record for the same reason.
    const discard = await request.delete(
      `${api}/projects/${PROJECT}/documents/${documentId}`,
      { headers: auth },
    );
    expect(discard.status()).toBe(403);
  });

  test('an issued document offers Withdraw and Archive, never Discard', async ({ page }) => {
    await signIn(page);
    await gotoRegister(page);
    await page.getByPlaceholder('Number, title or revision').fill(documentNumber);
    await page.getByText(documentNumber).click();
    await page.waitForURL(/\/documents\/[^/]+$/);

    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Discard draft' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Withdraw' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Archive' })).toBeVisible();
  });
});
