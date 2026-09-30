import {
  buildActivityTarget,
  groupTargetRefs,
  targetRefOf,
  type ActivityTargetRecords,
} from './project-activity-targets.js';

const outbox = (resource: string, resourceId: string, sourceCommand: string, after?: unknown) => ({
  resource,
  resourceId,
  sourceCommand,
  after,
});

describe('targetRefOf', () => {
  it.each([
    ['Contract', 'contract'],
    ['ContractPaymentPlan', 'contract'],
    ['ContractRetentionTerms', 'contract'],
    ['ContractPaymentInstallment', 'installment'],
    ['ContractAdvanceTerm', 'advanceTerm'],
    ['ContractDeliverable', 'deliverable'],
    ['ContractMilestone', 'deliverable'],
    ['ContractGuarantee', 'guarantee'],
    ['VariationOrder', 'variation'],
    ['ProjectDocument', 'document'],
    ['ProjectDocumentRevision', 'revision'],
    ['ProgrammeBaseline', 'baseline'],
  ])('an outbox %s row is named by its own record (%s)', (resource, kind) => {
    expect(targetRefOf(outbox(resource, 'x-1', 'some.command'))).toEqual({ kind, id: 'x-1' });
  });

  it('project rows, unknown types and request-logged rows name nothing', () => {
    expect(targetRefOf(outbox('Project', 'p-1', 'project.start'))).toBeNull();
    expect(targetRefOf(outbox('Mystery', 'm-1', 'mystery.do'))).toBeNull();
    expect(
      targetRefOf({ resource: '/api/v1/projects/:projectId/boq/import', resourceId: 'p-1', sourceCommand: null }),
    ).toBeNull();
  });

  it('invoice-issuing commands are named by the invoice they issued', () => {
    expect(
      targetRefOf(outbox('Contract', 'c-1', 'commercial.issuePackage', { milestoneInvoiceId: 'inv-1', voInvoiceIds: [] })),
    ).toEqual({ kind: 'invoice', id: 'inv-1' });
    expect(targetRefOf(outbox('Contract', 'c-1', 'commercial.preparePackage', { stageInvoiceId: 'inv-2' }))).toEqual({
      kind: 'invoice',
      id: 'inv-2',
    });
    expect(
      targetRefOf(outbox('Contract', 'c-1', 'commercial.issueInvoice', { invoiceIds: ['inv-3', 'inv-4'] })),
    ).toEqual({ kind: 'invoice', id: 'inv-3' });
    // No invoice id recorded: falls back to the contract.
    expect(targetRefOf(outbox('Contract', 'c-1', 'commercial.issueInvoice', {}))).toEqual({
      kind: 'contract',
      id: 'c-1',
    });
  });

  it('a project payment is named by its receipt; without one it names nothing', () => {
    expect(
      targetRefOf(outbox('Project', 'p-1', 'commercial.recordProjectPayment', { receiptId: 'r-1', amount: 900 })),
    ).toEqual({ kind: 'receipt', id: 'r-1' });
    expect(targetRefOf(outbox('Project', 'p-1', 'commercial.recordProjectPayment', null))).toBeNull();
  });
});

describe('groupTargetRefs', () => {
  it('deduplicates ids per kind and ignores rows without a target', () => {
    const grouped = groupTargetRefs([
      { kind: 'contract', id: 'c-1' },
      null,
      { kind: 'contract', id: 'c-1' },
      { kind: 'variation', id: 'v-1' },
    ]);
    expect(Object.fromEntries(grouped)).toEqual({ contract: ['c-1'], variation: ['v-1'] });
  });
});

describe('buildActivityTarget', () => {
  const records: ActivityTargetRecords = new Map([
    ['contract', new Map([['c-1', { reference: 'ACC-HDN-26-0005-C1' }]])],
    ['variation', new Map([['v-1', { reference: 'VO-003' }]])],
    [
      'invoice',
      new Map([
        ['inv-1', { reference: 'INV-2026-0012' }],
        ['inv-draft', { reference: null }],
      ]),
    ],
    ['document', new Map([['d-1', { reference: 'DWG-101' }]])],
    ['revision', new Map([['r-1', { reference: 'DWG-101 rev. B', documentId: 'd-1' }]])],
    ['baseline', new Map([['b-1', { reference: 'v2' }]])],
    ['advanceTerm', new Map([['a-1', { reference: `  Mobilisation\n advance ${'x'.repeat(100)}` }]])],
  ]);

  it('labels the record by its reference and links to its page', () => {
    expect(buildActivityTarget('p-1', { kind: 'contract', id: 'c-1' }, records)).toEqual({
      label: 'ACC-HDN-26-0005-C1',
      href: '/projects/p-1/commercial/contract',
    });
    expect(buildActivityTarget('p-1', { kind: 'variation', id: 'v-1' }, records)).toEqual({
      label: 'VO-003',
      href: '/projects/p-1/commercial/contract',
    });
    expect(buildActivityTarget('p-1', { kind: 'invoice', id: 'inv-1' }, records)).toEqual({
      label: 'INV-2026-0012',
      href: '/projects/p-1/commercial/invoices/inv-1',
    });
    expect(buildActivityTarget('p-1', { kind: 'document', id: 'd-1' }, records)).toEqual({
      label: 'DWG-101',
      href: '/projects/p-1/documents/d-1',
    });
    expect(buildActivityTarget('p-1', { kind: 'revision', id: 'r-1' }, records)).toEqual({
      label: 'DWG-101 rev. B',
      href: '/projects/p-1/documents/d-1',
    });
  });

  it('a record with no page of its own is labelled without a link', () => {
    expect(buildActivityTarget('p-1', { kind: 'baseline', id: 'b-1' }, records)).toEqual({ label: 'v2' });
  });

  it('free text is flattened to one line and clipped', () => {
    const target = buildActivityTarget('p-1', { kind: 'advanceTerm', id: 'a-1' }, records);
    expect(target?.label.startsWith('Mobilisation advance x')).toBe(true);
    expect(target?.label.length).toBe(80);
    expect(target?.label.endsWith('…')).toBe(true);
  });

  it('a missing record, a record without a reference, or no ref at all → null', () => {
    expect(buildActivityTarget('p-1', { kind: 'contract', id: 'gone' }, records)).toBeNull();
    expect(buildActivityTarget('p-1', { kind: 'invoice', id: 'inv-draft' }, records)).toBeNull();
    expect(buildActivityTarget('p-1', { kind: 'guarantee', id: 'g-1' }, records)).toBeNull();
    expect(buildActivityTarget('p-1', null, records)).toBeNull();
  });
});
