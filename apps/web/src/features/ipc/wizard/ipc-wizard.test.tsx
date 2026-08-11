import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/**
 * ─── Characterization tests for the IPC wizard's state seeding ──────────────────
 *
 * Written **before** the effects in this file were refactored, against the behaviour as it
 * then stood, so the refactor could be judged by whether these still pass.
 *
 * The wizard had two `react-hooks/set-state-in-effect` errors that failed CI on every pull
 * request in the repository. They had been left alone — correctly — because this code restores
 * a saved certificate draft and there was no test on it at all. Getting the seeding wrong here
 * does not throw: it silently certifies the wrong quantities, which is money.
 *
 * The four rules being pinned:
 *
 *  1. A saved draft wins. Rows, context and deductions all come from it.
 *  2. With no draft, rows are seeded from the IPA's claimed quantities.
 *  3. IPA data arriving later must not overwrite a restored draft.
 *  4. Edits are persisted, and survive.
 */

const mocks = vi.hoisted(() => ({
  useIpa: vi.fn(),
  useContract: vi.fn(),
  useIpcs: vi.fn(),
  useIssueIpc: vi.fn(),
  useBoqTree: vi.fn(),
}));

vi.mock('@/features/ipa/hooks/use-ipa', () => ({ useIpa: mocks.useIpa }));
vi.mock('@/features/contracts/hooks/use-contracts', () => ({ useContract: mocks.useContract }));
vi.mock('@/features/boq/hooks/use-boq', () => ({ useBoqTree: mocks.useBoqTree }));
vi.mock('../hooks/use-ipc', () => ({
  useIpcs: mocks.useIpcs,
  useIssueIpc: mocks.useIssueIpc,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

import { emptyContext, loadDraft, saveDraft, type WizardDraft } from './draft';
import { IpcWizard } from './ipc-wizard';

const IPA_ID = 'ipa-1';

const IPA = {
  id: IPA_ID,
  status: 'SUBMITTED',
  items: [
    { id: 'item-1', boqNodeId: 'node-1', cumulativeClaimed: '25', unitRateSnapshot: '850.00' },
    { id: 'item-2', boqNodeId: 'node-2', cumulativeClaimed: '10', unitRateSnapshot: '100.00' },
  ],
  deductions: [],
};

const CONTRACT = { id: 'c-1', projectId: 'p-1', boqVersionId: 'v-1', currency: 'SAR' };

function loaded<T>(data: T) {
  return { data, isPending: false, isError: false, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();

  mocks.useIpa.mockReturnValue(loaded(IPA));
  mocks.useContract.mockReturnValue(loaded(CONTRACT));
  mocks.useIpcs.mockReturnValue(loaded([]));
  mocks.useBoqTree.mockReturnValue(loaded([]));
  mocks.useIssueIpc.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
});

afterEach(() => {
  sessionStorage.clear();
});

function render() {
  return renderWithProviders(<IpcWizard contractId="c-1" ipaId={IPA_ID} />);
}

/** The draft the wizard has written, read back through the module that owns the format. */
function persisted(): WizardDraft | null {
  return loadDraft(IPA_ID);
}

describe('IpcWizard — seeding rows with no saved draft', () => {
  /**
   * Rule 2. Every claimed line becomes a certifiable row, pre-filled with the claimed
   * quantity — certifying in full is the common case, and a blank field would make the
   * quantity surveyor retype figures the application already states.
   */
  it('seeds one row per IPA item, pre-filled with the claimed quantity', async () => {
    render();

    // The wizard persists on every change, so the seeded rows are observable through the draft.
    await vi.waitFor(() => {
      expect(persisted()?.rows).toEqual([
        { applicationItemId: 'item-1', certifiedQuantity: '25', varianceReason: '' },
        { applicationItemId: 'item-2', certifiedQuantity: '10', varianceReason: '' },
      ]);
    });
  });

  it('starts on step 1 with an empty context', async () => {
    render();

    await vi.waitFor(() => {
      expect(persisted()?.context.status).toBe('');
      expect(persisted()?.adHocDeductions).toEqual([]);
    });
  });
});

describe('IpcWizard — restoring a saved draft', () => {
  const SAVED: WizardDraft = {
    context: {
      status: 'PARTIALLY_CERTIFIED',
      showExchangeRate: false,
      exchangeRateCurrency: '',
      exchangeRateBase: '',
      exchangeRateValue: '',
      exchangeRateDate: '',
      notes: 'Partially certified pending site inspection',
    },
    rows: [
      { applicationItemId: 'item-1', certifiedQuantity: '18', varianceReason: 'Short delivery' },
      { applicationItemId: 'item-2', certifiedQuantity: '10', varianceReason: '' },
    ],
    adHocDeductions: [
      { key: 'd-1', deductionType: 'OTHER', basis: 'Site damage', amount: '250.00' },
    ],
  };

  /**
   * Rule 1, and the one that costs money if it breaks. A restored draft holds quantities a
   * surveyor already reduced; re-seeding from the IPA would silently put them back up to the
   * full claimed amount, and the screen would look correct.
   */
  it('restores rows from the draft rather than re-seeding from the IPA', async () => {
    saveDraft(IPA_ID, SAVED);
    render();

    await vi.waitFor(() => {
      expect(persisted()?.rows).toEqual(SAVED.rows);
    });

    // Specifically: item-1 stays at the certified 18, not the claimed 25.
    expect(persisted()?.rows[0]!.certifiedQuantity).toBe('18');
  });

  it('restores the context and the ad-hoc deductions', async () => {
    saveDraft(IPA_ID, SAVED);
    render();

    await vi.waitFor(() => {
      expect(persisted()?.context.notes).toBe(SAVED.context.notes);
      expect(persisted()?.context.status).toBe('PARTIALLY_CERTIFIED');
      expect(persisted()?.adHocDeductions).toEqual(SAVED.adHocDeductions);
    });
  });

  /**
   * Rule 3. The IPA is fetched, so it can resolve after the first render. The draft must
   * still win when it does.
   */
  it('keeps the restored rows when the IPA resolves afterwards', async () => {
    saveDraft(IPA_ID, SAVED);
    mocks.useIpa.mockReturnValue({ data: undefined, isPending: true, isError: false });

    const { rerender } = render();

    mocks.useIpa.mockReturnValue(loaded(IPA));
    rerender(<IpcWizard contractId="c-1" ipaId={IPA_ID} />);

    await vi.waitFor(() => {
      expect(persisted()?.rows[0]!.certifiedQuantity).toBe('18');
    });
  });

  it('tolerates a corrupt draft rather than failing to render', async () => {
    sessionStorage.setItem(`ipc-draft-${IPA_ID}`, '{ not json');

    expect(() => render()).not.toThrow();

    await vi.waitFor(() => {
      expect(persisted()?.rows).toHaveLength(2);
    });
  });
});

describe('IpcWizard — persistence', () => {
  /** Rule 4. Seeded rows are written straight away, so a refresh resumes rather than restarts. */
  it('persists the seeded rows without waiting for an edit', async () => {
    render();

    await vi.waitFor(() => {
      expect(persisted()?.rows).toHaveLength(2);
    });
  });

  it('writes nothing before the IPA has loaded', () => {
    mocks.useIpa.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render();

    expect(persisted()).toBeNull();
  });

  /**
   * Switching applications must not carry the previous one's certified quantities across. The
   * route reuses this component — `.../applications/[ipaId]/certificates/new` — so a different
   * IPA is a re-render, not a remount.
   */
  it('starts clean when pointed at a different application', async () => {
    saveDraft(IPA_ID, {
      context: emptyContext(),
      rows: [{ applicationItemId: 'item-1', certifiedQuantity: '18', varianceReason: 'Short' }],
      adHocDeductions: [],
    });

    const { rerender } = render();
    await vi.waitFor(() => expect(persisted()?.rows[0]!.certifiedQuantity).toBe('18'));

    const OTHER = { ...IPA, id: 'ipa-2', items: [{ ...IPA.items[0]!, cumulativeClaimed: '99' }] };
    mocks.useIpa.mockReturnValue(loaded(OTHER));
    rerender(<IpcWizard contractId="c-1" ipaId="ipa-2" />);

    await vi.waitFor(() => {
      expect(loadDraft('ipa-2')?.rows).toEqual([
        { applicationItemId: 'item-1', certifiedQuantity: '99', varianceReason: '' },
      ]);
    });

    // And the first application's draft is untouched.
    expect(loadDraft(IPA_ID)?.rows[0]!.certifiedQuantity).toBe('18');
  });
});
