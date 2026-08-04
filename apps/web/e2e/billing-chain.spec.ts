import { expect, scenario, test } from './fixtures';

/**
 * The billing chain, walked the way a person walks it.
 *
 * What this covers that nothing else can: the figures on these screens come from data the
 * client does not hold. A payment application's period quantity is derived from what a
 * certificate against an EARLIER application certified — a number no mocked API would
 * produce and no unit test could assert. The only way to know the chain agrees with itself
 * is to walk it against a real server.
 *
 * Assertions are on figures and links, not on layout. A test that breaks when a heading
 * moves teaches nothing and gets deleted.
 */
test.describe('billing chain', () => {
  test('a client leads to its contract, application and payment', async ({ app }) => {
    // ─── Client ──────────────────────────────────────────────────────────────────
    await app.goto(`/clients/${scenario.clientId}`);
    await expect(app.getByRole('heading', { level: 1 })).toContainText(scenario.clientName);

    // ─── Contract ────────────────────────────────────────────────────────────────
    await app.goto(`/contracts/${scenario.contractId}`);
    await expect(app.getByText(scenario.contractNumber)).toBeVisible();

    // The contract knows its client, and the link goes back to the right record.
    const clientLink = app.getByRole('link', { name: scenario.clientName });
    await expect(clientLink).toHaveAttribute('href', `/clients/${scenario.clientId}`);

    // ─── Retention terms carry through as percentages, not fractions ─────────────
    // The seed sets 0.0500 / 0.0500 / 0.5000. Reading those back as 0.05% would understate
    // retention a hundredfold, which is the mistake this screen exists to not make.
    await app.getByRole('tab', { name: 'Retention' }).click();
    await expect(app.getByText('5%').first()).toBeVisible();
    await expect(app.getByText('50%')).toBeVisible();

    // ─── Application ─────────────────────────────────────────────────────────────
    await app.goto(`/contracts/${scenario.contractId}/applications/${scenario.ipaId}`);

    if (scenario.ipaRef) {
      await expect(app.getByText(scenario.ipaRef)).toBeVisible();
    }
    await expect(app.getByText('This application is final. Nothing about it can change.')).toBeVisible();

    // Claimed lines are labelled by their BOQ line, not by an opaque id — the C15 join.
    await expect(app.getByText(/Substructure Works ›/).first()).toBeVisible();

    // The three totals are server-derived and must agree: gross − deductions = net.
    // Net payable is the page heading — it is the number the screen exists to state — while
    // the two it is derived from sit in the summary list beneath.
    const gross = await readMoney(app, 'Period total');
    const deductions = await readMoney(app, 'Deductions');
    const net = parseMoney(await app.getByRole('heading', { level: 1 }).innerText());

    expect(
      Math.round((gross - deductions) * 100),
      'the application header must reconcile: gross − deductions = net',
    ).toBe(Math.round(net * 100));

    // ─── Receipt ─────────────────────────────────────────────────────────────────
    await app.goto(`/receipts/${scenario.receiptId}`);

    if (scenario.receiptReference) {
      await expect(app.getByText(scenario.receiptReference)).toBeVisible();
    }
    await expect(app.getByText(scenario.clientName)).toBeVisible();

    // The seeded receipt settles the certificate exactly, so nothing is left unapplied and
    // the receipt must not read as over-allocated.
    const unallocated = await readMoney(app, 'Unallocated');
    expect(unallocated, 'the seeded receipt is allocated in full').toBe(0);
    await expect(app.getByText('Fully allocated')).toBeVisible();
    await expect(app.getByText('Over-allocated')).toBeHidden();

    // The allocation names its certificate rather than showing a cuid.
    await expect(app.getByText(/^IPC-\d+$/)).toBeVisible();
  });

  test('the receipt allocation matches what the certificate certified', async ({ app }) => {
    await app.goto(`/receipts/${scenario.receiptId}`);

    const allocated = await readMoney(app, 'Allocated');

    // `netCertified` comes from the API; the screen computes its own total from the
    // allocations in integer cents. They must agree — that equality is the whole point of
    // the receipt screen, and it spans three aggregates and two independent code paths.
    expect(
      Math.round(allocated * 100),
      'allocated on the receipt must equal the certificate net',
    ).toBe(Math.round(Number(scenario.netCertified) * 100));
  });
});

/**
 * Reads a labelled money figure from a definition list.
 *
 * Parses back to a number so the assertion is about the VALUE rather than its formatting —
 * a test that compares "$137,360.00" as a string fails the moment the locale changes,
 * which is not a regression.
 */
async function readMoney(page: import('@playwright/test').Page, label: string): Promise<number> {
  const text = await page
    .locator('dt', { hasText: new RegExp(`^${label}$`) })
    .first()
    .locator('xpath=following-sibling::dd[1]')
    .innerText();

  return parseMoney(text, label);
}

/** Strips currency and grouping so the assertion is about the value, not its formatting. */
function parseMoney(text: string, label = 'value'): number {
  const value = Number(text.replace(/[^0-9.-]/g, ''));
  expect(Number.isFinite(value), `could not read a number from "${label}": ${text}`).toBe(true);
  return value;
}
