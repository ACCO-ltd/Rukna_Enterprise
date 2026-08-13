import { readFileSync } from 'node:fs';

import { test as base, expect, type Page } from '@playwright/test';

import { SCENARIO_PATH, type Scenario } from './global-setup';

export { expect };

/** The scenario seeded by `global-setup`, read once per worker. */
export const scenario: Scenario = JSON.parse(readFileSync(SCENARIO_PATH, 'utf8')) as Scenario;

/**
 * Signs in through the real login form.
 *
 * Not via an API call and a cookie: the access token lives in memory by design
 * (`apps/web/CLAUDE.md:222`), so there is nothing to inject. Logging in the way a person
 * does also means the suite would notice if the login flow broke — which is the one screen
 * whose failure hides every other test's failure behind a redirect.
 */
export async function signIn(page: Page): Promise<void> {
  const password = process.env['RUKNA_DEMO_PASSWORD'];
  if (!password) throw new Error('RUKNA_DEMO_PASSWORD is required for browser tests');
  await page.goto('/login');
  await page.getByLabel('Email address').fill('admin@acco.com');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|projects|clients|contracts|receipts)/);
}

/**
 * Switches the UI language and waits for the document direction to follow.
 *
 * Targets the button's visible text, not its accessible name. The `aria-label` is itself
 * translated — once the UI is Arabic, "Switch language to English" becomes
 * "تغيير اللغة إلى الإنجليزية" — so a name-based locator can enter Arabic and never find its
 * way back out. The visible labels are endonyms ("English", "العربية"), identical in both
 * message files, which makes them the one locale-independent handle on these controls.
 */
export async function switchTo(page: Page, locale: 'en' | 'ar'): Promise<void> {
  const endonym = locale === 'ar' ? 'العربية' : 'English';
  await page.locator('[role="group"] > button', { hasText: endonym }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
}

/**
 * A signed-in page.
 *
 * Session state is not reused across tests: each gets a clean sign-in, so one test's
 * navigation cannot leave another in an unexpected place.
 */
export const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await signIn(page);
    await use(page);
  },
});

/**
 * Asserts the page does not scroll sideways.
 *
 * The rule from `apps/web/CLAUDE.md`: wide content — tables, tab strips — scrolls inside
 * its own container, and the document never does. A horizontally scrolling page is the
 * single most common way a desktop-first layout fails on a phone, and it is invisible at
 * any width where the content happens to fit.
 *
 * One pixel of tolerance: sub-pixel rounding on a fractional viewport can report a
 * scrollWidth a hair over clientWidth with nothing actually clipped.
 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });

  expect(
    overflow.scrollWidth,
    `document scrolls horizontally: ${overflow.scrollWidth}px of content in ${overflow.clientWidth}px`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/**
 * Asserts every interactive control is large enough to hit with a thumb.
 *
 * `apps/web/CLAUDE.md` requires 44×44px touch targets. Checked at the height only —
 * a full-width button is tall enough to be reachable regardless of how narrow its label
 * is, and width varies legitimately with content.
 *
 * Hidden and zero-size elements are skipped: a control inside a closed dialog or a
 * collapsed panel is not a target anyone can miss.
 */
export async function expectTouchTargets(page: Page): Promise<void> {
  const undersized = await page.evaluate(() => {
    const MIN = 44;
    const problems: { text: string; height: number }[] = [];

    for (const el of document.querySelectorAll('button, a[href], select, input:not([type="hidden"])')) {
      // Dev-only tooling is not our markup and is absent from a production build: Next.js
      // injects its overlay into a portal, and the TanStack Query devtools launcher is
      // mounted behind a NODE_ENV check (`src/providers/query-provider.tsx:15`).
      if (el.closest('nextjs-portal') || el.classList.contains('tsqd-open-btn')) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      // Visually-hidden-until-focused controls — the skip link — are 1px by design. That
      // is the correct pattern, not a small target: it becomes full size when focused,
      // which is the only time it can be activated.
      const styles = getComputedStyle(el);
      if (styles.clip === 'rect(0px, 0px, 0px, 0px)' || rect.height <= 1) continue;

      // Inline links inside prose are not touch targets in the same sense; the rule is
      // about controls, so anchors that sit inside a paragraph are exempt.
      if (el.tagName === 'A' && el.closest('p')) continue;

      if (rect.height < MIN) {
        problems.push({ text: (el.textContent ?? '').trim().slice(0, 40), height: Math.round(rect.height) });
      }
    }

    return problems;
  });

  expect(undersized, `controls under 44px tall: ${JSON.stringify(undersized)}`).toEqual([]);
}
