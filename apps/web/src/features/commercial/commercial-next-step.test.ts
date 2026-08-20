import { describe, expect, it } from 'vitest';
import type {
  CommercialAttentionItem,
  CommercialCapabilities,
  CommercialSummaryResponse,
} from '@erp/types';

import { resolveCommercialNextStep } from './commercial-next-step';

const ALL_CAPABILITIES: CommercialCapabilities = {
  canViewFinancials: true,
  canEditContract: true,
  canAdvanceContract: true,
      canCreateApplication: true,
      canManageApplication: true,
  canReviewApplication: true,
  canIssueCertificate: true,
      canGenerateInvoice: true,
      canPostInvoice: true,
      canManageGuarantee: true,
      canRecordReceipt: false,
      canAllocateReceipt: false,
};

function metric() {
  return {
    state: 'OK' as const,
    amount: '1000.00',
    currency: 'USD',
    sourceCount: 1,
    drillTo: null,
    asOf: '2026-08-14T00:00:00.000Z',
  };
}

function summary(overrides: Partial<CommercialSummaryResponse> = {}): CommercialSummaryResponse {
  return {
    projectId: 'p-1',
    currency: 'USD',
    financialsVisible: true,
    mainContract: {
      id: 'c-1',
      contractNumber: 'CN-2026-014',
      status: 'ACTIVE',
      clientName: 'Baraka Real Estate LLC',
      startDate: null,
      expectedEndDate: null,
      contractValue: '12400000.00',
      currency: 'USD',
      billingModel: 'MEASURED_IPC',
      boqVersionNumber: 3,
    },
    metrics: {
      contractValue: metric(),
      certifiedGross: metric(),
      certifiedNet: metric(),
      invoiced: metric(),
      received: metric(),
      outstanding: metric(),
      uninvoicedCertified: metric(),
    },
    certification: { applicationsSubmitted: 9, effectiveCertificates: 8, postedInvoices: 7 },
    receivables: { collectionRate: 82, outstandingInvoices: [] },
    retention: null,
    advances: [],
    guarantees: [],
    attention: [],
    capabilities: ALL_CAPABILITIES,
    recentActivity: [],
    asOf: '2026-08-14T00:00:00.000Z',
    ...overrides,
  };
}

function attention(kind: CommercialAttentionItem['kind'], actionUrl: string | null = null) {
  return {
    id: `${kind}-1`,
    severity: 'WARNING' as const,
    kind,
    actionUrl,
    responsibleRole: null,
    contextId: null,
  };
}

describe('resolveCommercialNextStep', () => {
  it('offers the contract when nothing governs the project yet', () => {
    const step = resolveCommercialNextStep(
      summary({
        mainContract: null,
        attention: [attention('NO_MAIN_CONTRACT', '/contracts/new?projectId=p-1')],
      }),
      'p-1',
    );

    expect(step).toEqual({ kind: 'CREATE_CONTRACT', href: '/contracts/new?projectId=p-1' });
  });

  /** Without permission to create one, offering the button would only produce a 403. */
  it('offers nothing when there is no contract and the user cannot create one', () => {
    const step = resolveCommercialNextStep(
      summary({ mainContract: null, attention: [attention('NO_MAIN_CONTRACT', null)] }),
      'p-1',
    );

    expect(step).toBeNull();
  });

  /**
   * Certified work that has not been invoiced outranks raising the next application: the
   * money is already earned and simply has not been asked for.
   */
  it('prioritises invoicing certified work over raising the next application', () => {
    const step = resolveCommercialNextStep(
      summary({
        attention: [attention('UNINVOICED_CERTIFICATE'), attention('UNINVOICED_CERTIFICATE')],
      }),
      'p-1',
    );

    expect(step).toMatchObject({ kind: 'GENERATE_INVOICE', count: 2 });
    expect(step?.href).toBe('/projects/p-1/commercial/applications');
  });

  it('falls through to the next application on a live contract with nothing outstanding', () => {
    const step = resolveCommercialNextStep(summary(), 'p-1');

    expect(step).toMatchObject({ kind: 'CREATE_APPLICATION' });
  });

  it('skips invoicing the user cannot do and offers the application instead', () => {
    const step = resolveCommercialNextStep(
      summary({
        attention: [attention('UNINVOICED_CERTIFICATE')],
        capabilities: { ...ALL_CAPABILITIES, canGenerateInvoice: false },
      }),
      'p-1',
    );

    expect(step).toMatchObject({ kind: 'CREATE_APPLICATION' });
  });
});

describe('resolveCommercialNextStep — contract lifecycle', () => {
  /** Before execution the contract is the work; certification cannot begin against it. */
  it.each(['DRAFT', 'UNDER_REVIEW', 'PENDING_SIGNATURE'] as const)(
    'advances the contract itself while %s',
    (status) => {
      const base = summary();
      const step = resolveCommercialNextStep(
        { ...base, mainContract: { ...base.mainContract!, status } },
        'p-1',
      );

      expect(step).toEqual({
        kind: 'ADVANCE_CONTRACT',
        href: '/projects/p-1/commercial/contract-security',
      });
    },
  );

  /**
   * A closed contract is a record, not a workspace. Offering "create application" would
   * invite a 409 straight from CommercialTermPolicy.
   */
  it.each(['CLOSED', 'CANCELLED', 'TERMINATED'] as const)(
    'offers history rather than work when %s',
    (status) => {
      const base = summary();
      const step = resolveCommercialNextStep(
        { ...base, mainContract: { ...base.mainContract!, status } },
        'p-1',
      );

      expect(step).toEqual({
        kind: 'VIEW_HISTORY',
        href: '/projects/p-1/commercial/contract-security',
      });
    },
  );

  it('still offers work while the final account is pending', () => {
    const base = summary();
    const step = resolveCommercialNextStep(
      { ...base, mainContract: { ...base.mainContract!, status: 'FINAL_ACCOUNT_PENDING' } },
      'p-1',
    );

    expect(step).toMatchObject({ kind: 'CREATE_APPLICATION' });
  });

  it('offers nothing to a read-only viewer rather than a button that refuses', () => {
    const step = resolveCommercialNextStep(
      summary({
        capabilities: {
          ...ALL_CAPABILITIES,
          canAdvanceContract: false,
          canCreateApplication: false,
          canGenerateInvoice: false,
        },
      }),
      'p-1',
    );

    expect(step).toBeNull();
  });
});
