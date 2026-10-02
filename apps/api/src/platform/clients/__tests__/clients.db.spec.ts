/**
 * CL — clients redesign (docs/design/clients-redesign-contract.md), against Postgres.
 *
 *   CL-01  create normalises name/phone/email, requires a primary contact, audits; bad phone writes nothing
 *   CL-02  the ValidationPipe refuses `status` on PATCH and a create without primaryContact
 *   CL-03  one primary per client: first contact is primary, isPrimary demotes, DB partial index holds,
 *          concurrent "make me primary" adds still leave exactly one
 *   CL-04  make-primary switches; the primary cannot be deleted (409 CONTACT_IS_PRIMARY); others can
 *   CL-05  contact patch normalises + clears; update writes only changed fields
 *   CL-06  deactivate: blocked by an unfinished project, then by an open balance; allowed when clear;
 *          allowedCommands / deactivationBlockedBy follow; reactivate
 *   CL-07  list: search (name, code, contact name), status/type filters, pagination, money redaction,
 *          OWES/OVERDUE filters and outstanding sort (ignored without money permission)
 *   CL-08  overview: outstanding / overdue / overdueDays / oldest invoice / unapplied credit / contract
 *          value / collection status; redaction; metrics null with no projects
 *   CL-09  activity: audit entries for every write; invoices/receipts only with money permission,
 *          no amounts otherwise
 */
import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ClientService } from '../application/client.service';
import { ClientPrismaRepository } from '../infrastructure/client-prisma.repository';
import { TransactionalAuditOutboxService } from '../../audit-logs/application/transactional-audit-outbox.service';
import { UpdateClientDto } from '../presentation/dto/update-client.dto';
import { CreateClientDto } from '../presentation/dto/create-client.dto';

const prisma = new PrismaClient();
const tenancy = { getClient: () => prisma } as never;
const service = new ClientService(tenancy, new ClientPrismaRepository(), new TransactionalAuditOutboxService());

const DAY = 86_400_000;
const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const daysFromToday = (n: number) => new Date(today.getTime() + n * DAY);

const orgs: string[] = [];
const VIEW_ONLY = [PERMISSIONS.clientsView];
const MANAGER = [PERMISSIONS.clientsView, PERMISSIONS.clientsCreate, PERMISSIONS.clientsManage];
const FINANCE = [...MANAGER, PERMISSIONS.financialPositionView];

interface Org {
  orgId: string;
  manager: RequestIdentity;
  finance: RequestIdentity;
  viewer: RequestIdentity;
}

async function makeOrg(): Promise<Org> {
  const suffix = `cl${randomUUID().slice(0, 12)}`;
  const orgId = `test-org-${suffix}`;
  await prisma.organization.create({ data: { id: orgId, name: `Clients ${suffix}`, slug: `test-${suffix}`, status: 'ACTIVE' } });
  const user = await prisma.user.create({
    data: { email: `clients-${suffix}@cl.test`, passwordHash: 'x', firstName: 'Hodan', lastName: 'Abdi', organizationId: orgId },
  });
  orgs.push(orgId);
  const id = (permissions: string[]): RequestIdentity => ({
    userId: user.id,
    activeOrganizationId: orgId,
    tenantSlug: `test-${suffix}`,
    roles: ['test'],
    permissions,
  });
  return { orgId, manager: id(MANAGER), finance: id(FINANCE), viewer: id(VIEW_ONLY) };
}

async function cleanup(orgId: string) {
  const q = (sql: TemplateStringsArray, ...v: unknown[]) => prisma.$executeRaw(sql, ...v);
  await q`DELETE FROM audit_outbox_events WHERE organization_id = ${orgId}`;
  await prisma.auditLog.deleteMany({ where: { orgId } });
  await q`DELETE FROM client_invoices WHERE organization_id = ${orgId}`;
  await q`DELETE FROM payment_receipts WHERE organization_id = ${orgId}`;
  await q`DELETE FROM contracts WHERE organization_id = ${orgId}`;
  await q`DELETE FROM boq_versions WHERE boq_id IN (SELECT id FROM boqs WHERE organization_id = ${orgId})`;
  await q`DELETE FROM boqs WHERE organization_id = ${orgId}`;
  await q`DELETE FROM projects WHERE organization_id = ${orgId}`;
  await q`DELETE FROM client_contacts WHERE client_id IN (SELECT id FROM clients WHERE organization_id = ${orgId})`;
  await q`DELETE FROM clients WHERE organization_id = ${orgId}`;
  await q`DELETE FROM client_code_sequences WHERE organization_id = ${orgId}`;
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await q`DELETE FROM organizations WHERE id = ${orgId}`;
}

afterAll(async () => {
  for (const orgId of orgs) await cleanup(orgId);
  await prisma.$disconnect();
});

const contact = (name: string, number = '61 234 5678') => ({ name, phone: { country: 'SO', number } });

async function newClient(org: Org, name: string, extra: Partial<CreateClientDto> = {}) {
  return service.create(org.manager, { name, primaryContact: contact(`${name} Contact`), ...extra } as CreateClientDto);
}

let projectSeq = 0;
async function project(org: Org, clientId: string, status: Prisma.ProjectCreateInput['status'] = 'ACTIVE') {
  projectSeq += 1;
  return prisma.project.create({
    data: {
      organizationId: org.orgId,
      code: `PRJ-CL-${projectSeq}`,
      name: `Project ${projectSeq}`,
      status,
      clientId,
      createdBy: org.manager.userId,
    },
  });
}

async function contract(org: Org, projectId: string, clientId: string, value: number, status: 'ACTIVE' | 'DRAFT' | 'CLOSED' = 'ACTIVE') {
  const boq = await prisma.boq.upsert({
    where: { projectId },
    create: { projectId, organizationId: org.orgId },
    update: {},
  });
  const version = await prisma.boqVersion.create({
    data: { boqId: boq.id, versionNumber: Math.floor(Math.random() * 1e6), status: 'BASELINED', createdBy: org.manager.userId },
  });
  return prisma.contract.create({
    data: {
      organizationId: org.orgId,
      projectId,
      clientId,
      boqVersionId: version.id,
      contractNumber: `CTR-${randomUUID().slice(0, 8)}`,
      contractValue: value,
      currency: 'USD',
      status,
      createdBy: org.manager.userId,
    },
  });
}

let invoiceSeq = 0;
async function invoice(
  org: Org,
  clientId: string,
  opts: { outstanding: number; total?: number; dueDate: Date | null; projectId?: string; status?: 'POSTED' | 'NOT_POSTED' | 'OPENING_BALANCE' },
) {
  invoiceSeq += 1;
  const posted = (opts.status ?? 'POSTED') !== 'NOT_POSTED';
  return prisma.clientInvoice.create({
    data: {
      organizationId: org.orgId,
      clientId,
      projectId: opts.projectId ?? null,
      invoiceNumber: `INV-CL-${invoiceSeq}`,
      invoiceDate: daysFromToday(-60),
      dueDate: opts.dueDate,
      currencyCode: 'USD',
      subtotal: opts.total ?? opts.outstanding,
      vatAmount: 0,
      totalAmount: opts.total ?? opts.outstanding,
      outstandingAmount: opts.outstanding,
      billingAddressSnapshot: {},
      documentStatus: 'APPROVED',
      postingStatus: opts.status ?? 'POSTED',
      postedAt: posted ? new Date() : null,
      postedBy: posted ? org.manager.userId : null,
      createdBy: org.manager.userId,
    },
  });
}

async function expectError(promise: Promise<unknown>, type: unknown, errorCode: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(type as never);
  expect(((error as BadRequestException).getResponse() as { errorCode: string }).errorCode).toBe(errorCode);
  return (error as BadRequestException).getResponse() as Record<string, unknown>;
}

const primaries = (clientId: string) => prisma.clientContact.count({ where: { clientId, isPrimary: true } });

describe('CL — clients redesign', () => {
  let org: Org;
  beforeAll(async () => {
    org = await makeOrg();
  });

  it('CL-01 create normalises, requires a primary contact, audits; a bad phone writes nothing', async () => {
    const created = await service.create(org.manager, {
      name: '  Hormuud   Telecom ',
      type: 'COMPANY',
      countryCode: 'so',
      city: ' Mogadishu ',
      paymentTermsDays: 30,
      invoiceEmail: ' Billing@Hormuud.COM ',
      primaryContact: { name: ' Ahmed  Hassan ', phone: { country: 'SO', number: '61 234 5678' }, email: 'AHMED@hormuud.com', whatsappPhone: '+252 61 234 5678' },
    } as CreateClientDto);

    expect(created).toMatchObject({
      name: 'Hormuud Telecom',
      countryCode: 'SO',
      city: 'Mogadishu',
      paymentTermsDays: 30,
      invoiceEmail: 'billing@hormuud.com',
      defaultCurrency: 'USD',
      status: 'ACTIVE',
      allowedCommands: ['DEACTIVATE'],
      deactivationBlockedBy: null,
    });
    expect(created.code).toMatch(/^CLI-\d{6}$/);
    expect(created.contacts).toHaveLength(1);
    expect(created.contacts[0]).toMatchObject({
      name: 'Ahmed Hassan',
      phone: '+252612345678',
      whatsappPhone: '+252612345678',
      email: 'ahmed@hormuud.com',
      isPrimary: true,
    });

    // allowedCommands are computed for the caller: the manager may deactivate.
    expect((await service.findOne(org.manager, created.id)).allowedCommands).toEqual(['DEACTIVATE']);
    expect((await service.findOne(org.viewer, created.id)).allowedCommands).toEqual([]);

    const audit = await prisma.auditLog.findMany({ where: { orgId: org.orgId, resource: 'client', resourceId: created.id } });
    expect(audit.map((a) => a.sourceCommand)).toEqual(['client.create']);

    const before = await prisma.client.count({ where: { organizationId: org.orgId } });
    const response = await expectError(
      service.create(org.manager, { name: 'Nope', primaryContact: { name: 'X', phone: { country: 'SO', number: '12' } } } as CreateClientDto),
      BadRequestException,
      'PHONE_INVALID',
    );
    expect(response['field']).toBe('primaryContact.phone');
    await expectError(
      service.create(org.manager, { name: 'Nope', primaryContact: { name: 'X', phone: '+252612345678', email: 'bad@' } } as CreateClientDto),
      BadRequestException,
      'EMAIL_INVALID',
    );
    await expectError(service.create(org.manager, { name: 'Nope' } as CreateClientDto), BadRequestException, 'CONTACT_REQUIRED');
    expect(await prisma.client.count({ where: { organizationId: org.orgId } })).toBe(before);
  });

  it('CL-02 the ValidationPipe refuses status on PATCH and a create without primaryContact', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
    await expect(pipe.transform({ status: 'INACTIVE' }, { type: 'body', metatype: UpdateClientDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ city: 'Hargeisa' }, { type: 'body', metatype: UpdateClientDto })).resolves.toBeDefined();
    await expect(pipe.transform({ name: 'A' }, { type: 'body', metatype: CreateClientDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform({ name: 'A', primaryContact: { name: 'B', phone: { country: 'SO', number: '612345678' } } }, { type: 'body', metatype: CreateClientDto }),
    ).resolves.toBeDefined();
  });

  it('CL-03 exactly one primary per client — service rule, DB index, and under concurrency', async () => {
    const c = await newClient(org, 'One Primary Ltd');
    const second = await service.addContact(org.manager, c.id, contact('Second'));
    expect(second.isPrimary).toBe(false);
    const third = await service.addContact(org.manager, c.id, { ...contact('Third'), isPrimary: true });
    expect(third.isPrimary).toBe(true);
    expect(await primaries(c.id)).toBe(1);

    // The partial unique index refuses a second primary written behind the service's back.
    await expect(
      prisma.clientContact.create({ data: { clientId: c.id, name: 'Rogue', isPrimary: true } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // ...while any number of non-primary contacts is fine.
    await prisma.clientContact.create({ data: { clientId: c.id, name: 'Plain', isPrimary: false } });

    // A legacy client with no contacts: its first contact becomes primary whatever isPrimary says.
    const legacy = await prisma.client.create({ data: { organizationId: org.orgId, code: `CLI-LEG-${randomUUID().slice(0, 4)}`, name: 'Legacy' } });
    const first = await service.addContact(org.manager, legacy.id, { ...contact('First'), isPrimary: false });
    expect(first.isPrimary).toBe(true);

    // Concurrent "make me primary" adds serialise on the client row lock.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => service.addContact(org.manager, c.id, { ...contact(`Racer ${i}`), isPrimary: true })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(await primaries(c.id)).toBe(1);
  });

  it('CL-04 make-primary switches; the primary cannot be deleted; others can', async () => {
    const c = await newClient(org, 'Switch Ltd');
    const originalId = c.contacts[0].id;
    const other = await service.addContact(org.manager, c.id, contact('Other'));

    await expectError(service.removeContact(org.manager, c.id, originalId), ConflictException, 'CONTACT_IS_PRIMARY');

    const promoted = await service.makePrimary(org.manager, c.id, other.id);
    expect(promoted.isPrimary).toBe(true);
    expect(await primaries(c.id)).toBe(1);
    const detail = await service.findOne(org.manager, c.id);
    expect(detail.contacts[0].id).toBe(other.id); // primary first

    // Idempotent: making the primary primary again changes nothing and writes no audit row.
    const auditBefore = await prisma.auditLog.count({ where: { resourceId: c.id, resource: 'client' } });
    await service.makePrimary(org.manager, c.id, other.id);
    expect(await prisma.auditLog.count({ where: { resourceId: c.id, resource: 'client' } })).toBe(auditBefore);

    await service.removeContact(org.manager, c.id, originalId);
    expect(await prisma.clientContact.count({ where: { clientId: c.id } })).toBe(1);
    await expectError(service.removeContact(org.manager, c.id, other.id), ConflictException, 'CONTACT_IS_PRIMARY');

    // A contact of another client is not found through this one.
    const elsewhere = await newClient(org, 'Elsewhere Ltd');
    await expect(service.makePrimary(org.manager, c.id, elsewhere.contacts[0].id)).rejects.toMatchObject({ status: 404 });
  });

  it('CL-05 contact patch normalises and clears; update audits only changed fields', async () => {
    const c = await newClient(org, 'Patch Ltd', { city: 'Mogadishu' } as Partial<CreateClientDto>);
    const id = c.contacts[0].id;
    const patched = await service.updateContact(org.manager, c.id, id, {
      phone: '+254 712 345 678',
      whatsappPhone: { country: 'SO', number: '0612345678' },
      email: 'X@Y.COM',
      role: 'Finance',
    });
    expect(patched).toMatchObject({ phone: '+254712345678', whatsappPhone: '+252612345678', email: 'x@y.com', role: 'Finance' });
    const cleared = await service.updateContact(org.manager, c.id, id, { whatsappPhone: null, email: null });
    expect(cleared).toMatchObject({ whatsappPhone: null, email: null });
    await expectError(service.updateContact(org.manager, c.id, id, { phone: 'garbage' }), BadRequestException, 'PHONE_INVALID');

    const updated = await service.update(org.manager, c.id, { city: 'Mogadishu', registrationNumber: 'REG-1', paymentTermsDays: 45 });
    expect(updated).toMatchObject({ city: 'Mogadishu', registrationNumber: 'REG-1', paymentTermsDays: 45 });
    const row = await prisma.auditLog.findFirst({
      where: { resourceId: c.id, resource: 'client', sourceCommand: 'client.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row?.after).toEqual({ registrationNumber: 'REG-1', paymentTermsDays: 45 }); // city unchanged → not recorded
    await expectError(service.update(org.manager, c.id, { paymentTermsDays: 400 }), BadRequestException, 'PAYMENT_TERMS_INVALID');
    await expectError(service.update(org.manager, c.id, {}), BadRequestException, 'NO_CHANGES');
  });

  it('CL-06 deactivate is blocked by unfinished projects, then by an open balance; reactivate', async () => {
    const c = await newClient(org, 'Deactivate Ltd');
    const p = await project(org, c.id, 'DRAFT'); // DRAFT still blocks
    let detail = await service.findOne(org.manager, c.id);
    expect(detail).toMatchObject({ deactivationBlockedBy: 'ACTIVE_PROJECTS', allowedCommands: [] });
    await expectError(service.deactivate(org.manager, c.id, 'No longer a client'), ConflictException, 'CLIENT_HAS_ACTIVE_PROJECTS');

    await prisma.project.update({ where: { id: p.id }, data: { status: 'CLOSED' } });
    const inv = await invoice(org, c.id, { outstanding: 250, dueDate: daysFromToday(-5) });
    await invoice(org, c.id, { outstanding: 900, dueDate: null, status: 'NOT_POSTED' }); // unposted never counts
    detail = await service.findOne(org.viewer, c.id);
    expect(detail.deactivationBlockedBy).toBe('OPEN_BALANCE');
    await expectError(service.deactivate(org.manager, c.id, 'No longer a client'), ConflictException, 'CLIENT_HAS_OPEN_BALANCE');

    await prisma.clientInvoice.update({ where: { id: inv.id }, data: { outstandingAmount: 0 } });
    await expectError(service.deactivate(org.manager, c.id, ' x '), BadRequestException, 'REASON_INVALID');
    const inactive = await service.deactivate(org.manager, c.id, '  Duplicate   record ');
    expect(inactive).toMatchObject({ status: 'INACTIVE', allowedCommands: ['REACTIVATE'], deactivationBlockedBy: null });
    await expectError(service.deactivate(org.manager, c.id, 'again please'), ConflictException, 'CLIENT_ALREADY_INACTIVE');

    const audit = await prisma.auditLog.findFirst({ where: { resourceId: c.id, sourceCommand: 'client.deactivate' } });
    expect(audit?.reason).toBe('Duplicate record');

    const active = await service.reactivate(org.manager, c.id);
    expect(active).toMatchObject({ status: 'ACTIVE', allowedCommands: ['DEACTIVATE'] });
    await expectError(service.reactivate(org.manager, c.id), ConflictException, 'CLIENT_ALREADY_ACTIVE');
  });

  describe('list, overview and activity', () => {
    let o: Org;
    let alpha: string;
    let bravo: string;
    let charlie: string;
    let delta: string;

    beforeAll(async () => {
      o = await makeOrg();
      alpha = (await service.create(o.manager, { name: 'Alpha Builders', type: 'COMPANY', primaryContact: contact('Zahra Warsame') } as CreateClientDto)).id;
      bravo = (await service.create(o.manager, { name: 'Bravo Ministry', type: 'GOVERNMENT', primaryContact: contact('Omar Ali') } as CreateClientDto)).id;
      charlie = (await service.create(o.manager, { name: 'Charlie NGO', type: 'NGO', primaryContact: contact('Fadumo Yusuf') } as CreateClientDto)).id;
      delta = (await service.create(o.manager, { name: 'Delta Homes', type: 'INDIVIDUAL', primaryContact: contact('Abdi Nur') } as CreateClientDto)).id;
      // Bravo owes 1000, of which 400 overdue; Charlie owes 3000 not yet due; Alpha owes nothing.
      await invoice(o, bravo, { outstanding: 400, dueDate: daysFromToday(-3) });
      await invoice(o, bravo, { outstanding: 600, dueDate: daysFromToday(20) });
      await invoice(o, charlie, { outstanding: 3000, dueDate: daysFromToday(10) });
      await project(o, alpha, 'ACTIVE');
      await project(o, alpha, 'CLOSED');
      await prisma.client.update({ where: { id: delta }, data: { status: 'INACTIVE' } });
    });

    it('CL-07a search matches name, code and any contact name; filters and pagination', async () => {
      const byName = await service.findList(o.manager, { search: 'bravo' });
      expect(byName.items.map((i) => i.id)).toEqual([bravo]);
      const byContact = await service.findList(o.manager, { search: 'fadumo' });
      expect(byContact.items.map((i) => i.id)).toEqual([charlie]);
      const code = (await prisma.client.findUniqueOrThrow({ where: { id: alpha } })).code;
      expect((await service.findList(o.manager, { search: code.toLowerCase() })).items.map((i) => i.id)).toEqual([alpha]);

      expect((await service.findList(o.manager, { status: 'INACTIVE' })).items.map((i) => i.id)).toEqual([delta]);
      expect((await service.findList(o.manager, { type: 'NGO' })).items.map((i) => i.id)).toEqual([charlie]);

      const page1 = await service.findList(o.manager, { pageSize: 3 });
      const page2 = await service.findList(o.manager, { pageSize: 3, page: 2 });
      expect(page1).toMatchObject({ total: 4, page: 1, pageSize: 3 });
      expect(page1.items.map((i) => i.name)).toEqual(['Alpha Builders', 'Bravo Ministry', 'Charlie NGO']);
      expect(page2.items.map((i) => i.name)).toEqual(['Delta Homes']);
      expect((await service.findList(o.manager, { sort: '-name', pageSize: 1 })).items[0].name).toBe('Delta Homes');

      const a = page1.items[0];
      expect(a).toMatchObject({
        primaryContact: { name: 'Zahra Warsame', phone: '+252612345678' },
        activeProjectCount: 1,
        totalProjectCount: 2,
        type: 'COMPANY',
      });
    });

    it('CL-07b money: visible with the permission, null (never 0) without; balance filters + outstanding sort', async () => {
      const finance = await service.findList(o.finance, {});
      expect(finance.moneyVisible).toBe(true);
      const byId = new Map(finance.items.map((i) => [i.id, i]));
      expect(byId.get(bravo)).toMatchObject({ outstanding: '1000.00', overdue: '400.00' });
      expect(byId.get(charlie)).toMatchObject({ outstanding: '3000.00', overdue: '0.00' });
      expect(byId.get(alpha)).toMatchObject({ outstanding: '0.00', overdue: '0.00' });

      const viewer = await service.findList(o.viewer, {});
      expect(viewer.moneyVisible).toBe(false);
      expect(viewer.items.every((i) => i.outstanding === null && i.overdue === null)).toBe(true);

      expect((await service.findList(o.finance, { balance: 'OWES' })).items.map((i) => i.id)).toEqual([bravo, charlie]);
      expect((await service.findList(o.finance, { balance: 'OVERDUE' })).items.map((i) => i.id)).toEqual([bravo]);
      expect((await service.findList(o.finance, { sort: '-outstanding' })).items.map((i) => i.id).slice(0, 2)).toEqual([charlie, bravo]);
      expect((await service.findList(o.finance, { sort: 'outstanding', status: 'ACTIVE' })).items.map((i) => i.id)).toEqual([alpha, bravo, charlie]);

      // Without the permission the money filter and sort are ignored, so ordering leaks nothing.
      expect((await service.findList(o.viewer, { balance: 'OVERDUE' })).total).toBe(4);
      expect((await service.findList(o.viewer, { sort: '-outstanding' })).items.map((i) => i.name)).toEqual([
        'Alpha Builders',
        'Bravo Ministry',
        'Charlie NGO',
        'Delta Homes',
      ]);
    });

    it('CL-08 overview figures and redaction', async () => {
      const c = await newClient(o, 'Overview Co');
      const p1 = await project(o, c.id, 'ACTIVE');
      const p2 = await project(o, c.id, 'CLOSED');
      await contract(o, p1.id, c.id, 100000, 'ACTIVE');
      await contract(o, p2.id, c.id, 40000, 'CLOSED');
      const oldest = await invoice(o, c.id, { outstanding: 500, dueDate: daysFromToday(-12), projectId: p1.id });
      await invoice(o, c.id, { outstanding: 250, dueDate: daysFromToday(-2), projectId: p1.id });
      await invoice(o, c.id, { outstanding: 100, dueDate: daysFromToday(3), projectId: p2.id });
      await invoice(o, c.id, { outstanding: 50, dueDate: daysFromToday(30) });
      await invoice(o, c.id, { outstanding: 0, total: 999, dueDate: daysFromToday(-40), projectId: p1.id }); // paid
      await invoice(o, c.id, { outstanding: 777, dueDate: daysFromToday(-40), status: 'NOT_POSTED' }); // never counts
      await prisma.paymentReceipt.create({
        data: {
          organizationId: o.orgId,
          clientId: c.id,
          receiptDate: today,
          accountingDate: today,
          totalAmount: 300,
          allocatedAmount: 100,
          unallocatedAmount: 200,
          currencyCode: 'USD',
          postingStatus: 'POSTED',
          postedAt: new Date(),
          postedBy: o.manager.userId,
          receiptNumber: `RCP-${randomUUID().slice(0, 6)}`,
          createdBy: o.manager.userId,
        },
      });

      const view = await service.findOverview(o.finance, c.id);
      expect(view.moneyVisible).toBe(true);
      expect(view.metrics).toEqual({
        activeProjectCount: 1,
        totalProjectCount: 2,
        activeContractValue: '100000.00',
        outstanding: '900.00',
        unpaidInvoiceCount: 4,
        overdue: '750.00',
        overdueDays: 12,
        oldestOverdueInvoice: { id: oldest.id, invoiceNumber: oldest.invoiceNumber },
        unappliedCredit: '200.00',
      });
      const projects = new Map(view.projects.map((p) => [p.id, p]));
      expect(projects.get(p1.id)).toMatchObject({ contractValue: '100000.00', outstanding: '750.00', status: 'ACTIVE' });
      expect(projects.get(p2.id)).toMatchObject({ contractValue: '40000.00', outstanding: '100.00' });
      expect(view.unpaidInvoices?.map((i) => [i.balance, i.collectionStatus, i.projectName])).toEqual([
        ['500.00', 'OVERDUE', p1.name],
        ['250.00', 'OVERDUE', p1.name],
        ['100.00', 'DUE_SOON', p2.name],
        ['50.00', 'CURRENT', null],
      ]);

      const redacted = await service.findOverview(o.viewer, c.id);
      expect(redacted).toMatchObject({ moneyVisible: false, metrics: null, unpaidInvoices: null });
      expect(redacted.projects).toHaveLength(2);
      expect(redacted.projects.every((p) => p.contractValue === null && p.outstanding === null)).toBe(true);

      const noProjects = await newClient(o, 'No Projects Co');
      expect((await service.findOverview(o.finance, noProjects.id)).metrics).toBeNull();

      // Review M1/M2: a debt migrated from the prior system, on no project, still shows and counts.
      const migrated = await newClient(o, 'Migrated Debt Co');
      await invoice(o, migrated.id, { outstanding: 1200, dueDate: daysFromToday(-5), status: 'OPENING_BALANCE' });
      const owed = await service.findOverview(o.finance, migrated.id);
      expect(owed.projects).toHaveLength(0);
      expect(owed.metrics).toMatchObject({ totalProjectCount: 0, outstanding: '1200.00', overdue: '1200.00', unpaidInvoiceCount: 1 });
      expect(owed.unpaidInvoices?.map((i) => [i.balance, i.projectName])).toEqual([['1200.00', null]]);
      await expect(service.deactivate(o.finance, migrated.id, 'Closed account')).rejects.toMatchObject({
        response: { errorCode: 'CLIENT_HAS_OPEN_BALANCE' },
      });
    });

    it('CL-09 activity: every write audited; money entries only with the permission', async () => {
      const c = await newClient(o, 'Activity Co');
      const extra = await service.addContact(o.manager, c.id, contact('Second Person'));
      await service.updateContact(o.manager, c.id, extra.id, { role: 'Site rep' });
      await service.makePrimary(o.manager, c.id, extra.id);
      await service.removeContact(o.manager, c.id, c.contacts[0].id);
      await service.update(o.manager, c.id, { city: 'Garowe' });
      await service.deactivate(o.manager, c.id, 'Moved away');
      await service.reactivate(o.manager, c.id);
      await invoice(o, c.id, { outstanding: 1234.5, dueDate: daysFromToday(5) });

      const viewer = await service.findActivity(o.viewer, c.id, 50);
      expect(viewer.map((e) => e.action).sort()).toEqual(
        [
          'client.create',
          'client.contact.add',
          'client.contact.update',
          'client.contact.make-primary',
          'client.contact.remove',
          'client.update',
          'client.deactivate',
          'client.reactivate',
        ].sort(),
      );
      expect(viewer.every((e) => e.actorName === 'Hodan Abdi')).toBe(true);
      expect(viewer.some((e) => /\d[\d,]*\.\d{2}/.test(e.summary))).toBe(false);
      expect(viewer.find((e) => e.action === 'client.deactivate')?.summary).toBe('Deactivated — Moved away');

      const finance = await service.findActivity(o.finance, c.id, 50);
      const inv = finance.find((e) => e.action === 'invoice.posted');
      expect(inv?.summary).toContain('USD 1,234.50');
      expect(finance).toHaveLength(viewer.length + 1);

      const limited = await service.findActivity(o.finance, c.id, 3);
      expect(limited).toHaveLength(3);
      expect(limited[0].at >= limited[2].at).toBe(true);
    });
  });
});
