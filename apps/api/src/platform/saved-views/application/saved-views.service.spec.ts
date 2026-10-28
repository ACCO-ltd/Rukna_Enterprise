import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { SavedViewsService } from './saved-views.service.js';

type Row = {
  id: string;
  organizationId: string;
  listKey: string;
  name: string;
  state: unknown;
  ownerUserId: string;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const user = (userId: string, admin = false): RequestIdentity => ({
  userId,
  activeOrganizationId: 'org-1',
  tenantSlug: 't',
  roles: [],
  permissions: admin ? ['manage:organization'] : [],
});

function build() {
  const rows: Row[] = [];
  let n = 0;
  const repo = {
    listVisible: jest.fn(async (_p: unknown, org: string, listKey: string, uid: string) =>
      rows.filter((r) => r.organizationId === org && r.listKey === listKey && (r.ownerUserId === uid || r.published)),
    ),
    findById: jest.fn(async (_p: unknown, org: string, id: string) => rows.find((r) => r.id === id && r.organizationId === org) ?? null),
    countOwned: jest.fn(async (_p: unknown, org: string, listKey: string, uid: string) =>
      rows.filter((r) => r.organizationId === org && r.listKey === listKey && r.ownerUserId === uid).length,
    ),
    findOwnedByName: jest.fn(async (_p: unknown, org: string, listKey: string, uid: string, name: string) =>
      rows.find((r) => r.organizationId === org && r.listKey === listKey && r.ownerUserId === uid && r.name.toLowerCase() === name.toLowerCase()) ?? null,
    ),
    create: jest.fn(async (_p: unknown, data: Omit<Row, 'id' | 'published' | 'createdAt' | 'updatedAt'>) => {
      const row: Row = { ...data, id: `v${++n}`, published: false, createdAt: new Date(), updatedAt: new Date() };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async (_p: unknown, id: string, data: Partial<Row>) => {
      const row = rows.find((r) => r.id === id)!;
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    delete: jest.fn(async (_p: unknown, id: string) => {
      rows.splice(rows.findIndex((r) => r.id === id), 1);
    }),
  };
  const service = new SavedViewsService({ getClient: () => ({}) } as never, repo as never);
  return { service, rows };
}

const create = (s: SavedViewsService, who: RequestIdentity, name = 'Overdue') =>
  s.create(who, { listKey: 'invoices', name, state: { filters: { status: 'APPROVED', posting: '' } } });

describe('SavedViewsService (Step 2a, ADR-047)', () => {
  it('a new view is personal: its owner sees it, nobody else does', async () => {
    const { service } = build();
    const view = await create(service, user('u1'));
    expect(view).toMatchObject({ name: 'Overdue', published: false, mine: true, state: { filters: { status: 'APPROVED' } } });
    expect(await service.list(user('u1'), 'invoices')).toHaveLength(1);
    expect(await service.list(user('u2'), 'invoices')).toHaveLength(0);
    await expect(service.update(user('u2'), view.id, { name: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('names are unique per owner and list, ignoring case', async () => {
    const { service } = build();
    await create(service, user('u1'));
    await expect(create(service, user('u1'), 'overdue')).rejects.toThrow(ConflictException);
    await expect(create(service, user('u2'), 'overdue')).resolves.toBeDefined();
  });

  it('only an admin publishes; then everyone sees it but only the owner or an admin may change it', async () => {
    const { service } = build();
    const view = await create(service, user('u1'));
    await expect(service.setPublished(user('u1'), view.id, true)).rejects.toThrow(ForbiddenException);

    // An admin can publish only a view they can see — someone's personal view does not exist to them.
    await expect(service.setPublished(user('admin', true), view.id, true)).rejects.toThrow(NotFoundException);
    const own = await create(service, user('admin', true), 'Team view');
    const published = await service.setPublished(user('admin', true), own.id, true);
    expect(published.published).toBe(true);

    const seen = await service.list(user('u2'), 'invoices');
    expect(seen.map((v) => [v.name, v.mine])).toEqual([['Team view', false]]);
    await expect(service.remove(user('u2'), own.id)).rejects.toThrow(ForbiddenException);
    await expect(service.update(user('admin2', true), own.id, { name: 'Team — renamed' })).resolves.toMatchObject({
      name: 'Team — renamed',
    });
  });

  it('rejects a malformed state and an unknown list', async () => {
    const { service } = build();
    await expect(
      service.create(user('u1'), { listKey: 'invoices', name: 'x', state: { sort: { key: 'a', direction: 'up' } } as never }),
    ).rejects.toThrow('The sort must name a column and a direction');
    await expect(service.list(user('u1'), 'Bad Key')).rejects.toThrow('Unknown list.');
  });

  it('caps views per user per list', async () => {
    const { service } = build();
    for (let i = 0; i < 30; i += 1) await create(service, user('u1'), `v${i}`);
    await expect(create(service, user('u1'), 'one more')).rejects.toThrow(ConflictException);
  });
});
