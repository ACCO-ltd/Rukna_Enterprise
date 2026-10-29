import { PERMISSIONS, type RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';

import { SearchService } from './search.service.js';

const who = (permissions: string[], userId = 'u1'): RequestIdentity => ({
  userId,
  activeOrganizationId: 'org-1',
  tenantSlug: 't',
  roles: [],
  permissions: permissions as never,
});

function build(projectIds: string[] | undefined = ['p1']) {
  const repo = {
    invoices: jest.fn().mockResolvedValue([
      {
        id: 'i1',
        invoiceNumber: 'INV-000118',
        invoiceDate: new Date('2026-08-28'),
        totalAmount: new Decimal('237500'),
        outstandingAmount: new Decimal('237500'),
        currencyCode: 'USD',
        documentStatus: 'APPROVED',
        postingStatus: 'POSTED',
        clientId: 'c1',
        client: { name: 'Hargeisa Water Agency' },
      },
    ]),
    bills: jest.fn().mockResolvedValue([]),
    payments: jest.fn().mockResolvedValue([]),
    receipts: jest.fn().mockResolvedValue([]),
    journals: jest.fn().mockResolvedValue([]),
    projects: jest.fn().mockResolvedValue([{ id: 'p1', code: 'ACC-HRG-26-01', name: 'Hargeisa Reservoir Works', status: 'ACTIVE', clientId: 'c1' }]),
    clients: jest.fn().mockResolvedValue([{ id: 'c1', code: 'CL-1', name: 'Hargeisa Water Agency', status: 'ACTIVE' }]),
    suppliers: jest.fn().mockResolvedValue([]),
  };
  const access = { accessibleProjectIds: jest.fn().mockResolvedValue(projectIds) };
  const service = new SearchService({ getClient: () => ({}) } as never, repo as never, access as never);
  return { service, repo, access };
}

describe('SearchService (Step 2f, ADR-047)', () => {
  it('runs only the groups the caller may open', async () => {
    const { service, repo } = build();
    const res = await service.search(who([PERMISSIONS.clientsView, PERMISSIONS.projectsView]), 'harg');
    expect(repo.invoices).not.toHaveBeenCalled();
    expect(repo.bills).not.toHaveBeenCalled();
    expect(repo.journals).not.toHaveBeenCalled();
    expect(res.records.map((r) => r.kind)).toEqual(['PROJECT', 'CLIENT']);
  });

  it('limits projects to the caller\'s memberships', async () => {
    const { service, repo } = build(['p1', 'p7']);
    await service.search(who([PERMISSIONS.projectsView]), 'harg');
    expect(repo.projects).toHaveBeenCalledWith(expect.anything(), 'org-1', 'harg', ['p1', 'p7']);
  });

  it('describes an invoice with its client, date, amount and the status that matters', async () => {
    const { service } = build();
    const res = await service.search(who([PERMISSIONS.receivablesManage]), ' INV-0001 ');
    expect(res.query).toBe('INV-0001');
    expect(res.records[0]).toEqual({
      kind: 'INVOICE',
      id: 'i1',
      title: 'INV-000118',
      detail: 'Hargeisa Water Agency · 2026-08-28',
      amount: '237500.00',
      currencyCode: 'USD',
      status: 'POSTED',
      clientId: 'c1',
    });
  });

  it('does not search on fewer than two characters', async () => {
    const { service, repo } = build();
    expect(await service.search(who([PERMISSIONS.clientsView]), 'h')).toEqual({ query: 'h', records: [] });
    expect(repo.clients).not.toHaveBeenCalled();
  });
});
