/**
 * Phase 0 H2 — a reversed invoice can be replaced; a reversed invoice cannot be posted again (live DB).
 *
 *   RB-01  reversing a certificate invoice releases its source; generating again raises a new
 *          invoice for the same certificate, which posts
 *   RB-02  the reversal is audited with the source it released
 *   RB-03  a reversed invoice cannot be posted again (A11)
 *   RB-04  a cancelled certificate draft does not hold the certificate: a new invoice is raised
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let contractId: string;
let ipcId: string;
let firstInvoiceId: string;
let auditorId: string;

const d = (n: number) => new Decimal(n);
const dates = () => ({
  invoiceDate: env.periods.openStart.toISOString().slice(0, 10),
  dueDate: env.periods.openEnd.toISOString().slice(0, 10),
});

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  // The shared helper builds services without audit; this spec audits as a real user row.
  (svc.clientInvoiceService as unknown as { auditOutbox: unknown }).auditOutbox = new TransactionalAuditOutboxService();
  auditorId = (
    await prisma.user.create({
      data: { email: `rb-${env.orgId}@rb.test`, passwordHash: 'x', firstName: 'Rebill', lastName: 'Test', organizationId: env.orgId },
    })
  ).id;
  contractId = (await prisma.contract.findFirstOrThrow({ where: { organizationId: env.orgId } })).id;
  const ipa = await prisma.interimPaymentApplication.create({
    data: { organizationId: env.orgId, contractId, applicationNumber: 1, status: 'SUBMITTED', createdBy: env.identity.userId },
  });
  ipcId = (
    await prisma.interimPaymentCertificate.create({
      data: {
        organizationId: env.orgId,
        applicationId: ipa.id,
        certificateNumber: 1,
        status: 'CERTIFIED',
        isEffective: true,
        effectiveAt: new Date(),
        certifiedTotal: d(80_000),
        currency: 'USD',
        createdBy: env.identity.userId,
      },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  await prisma.auditOutboxEvent.deleteMany({ where: { organizationId: env.orgId } });
  await prisma.auditLog.deleteMany({ where: { orgId: env.orgId } });
  await prisma.user.deleteMany({ where: { id: auditorId } });
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('RB-01: a reversed certificate invoice is replaced by a new invoice for the same certificate', async () => {
  const first = await svc.clientInvoiceService.generateFromIpc(env.identity, { ipcId, ...dates() });
  firstInvoiceId = first.id;
  await svc.clientInvoiceService.approve(env.identity, first.id);
  await svc.clientInvoiceService.post(env.identity, { invoiceId: first.id });
  // Before the reversal, generating again returns the live invoice.
  expect((await svc.clientInvoiceService.generateFromIpc(env.identity, { ipcId, ...dates() })).id).toBe(first.id);

  await svc.clientInvoiceService.reverse({ ...env.identity, userId: auditorId }, first.id, { reversalDate: dates().invoiceDate, reason: 'RB-01' });
  const reversed = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: first.id } });
  expect(reversed.postingStatus).toBe('REVERSED');
  expect(reversed.sourceIpcId).toBeNull();

  const replacement = await svc.clientInvoiceService.generateFromIpc(env.identity, { ipcId, ...dates() });
  expect(replacement.id).not.toBe(first.id);
  expect(replacement.sourceIpcId).toBe(ipcId);
  expect(replacement.subtotal.toFixed(2)).toBe('80000.00');
  await svc.clientInvoiceService.approve(env.identity, replacement.id);
  await svc.clientInvoiceService.post(env.identity, { invoiceId: replacement.id });
  const posted = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: replacement.id } });
  expect(posted.postingStatus).toBe('POSTED');
  expect(posted.invoiceNumber).not.toBe(reversed.invoiceNumber);
});

it('RB-02: the reversal is audited with the source it released', async () => {
  const audit = await prisma.auditLog.findFirstOrThrow({
    where: { orgId: env.orgId, resource: 'ClientInvoice', resourceId: firstInvoiceId, action: 'REVERSE' },
  });
  expect(audit.before).toMatchObject({ sourceIpcId: ipcId });
  expect(audit.after).toMatchObject({ postingStatus: 'REVERSED', sourceReleased: true });
});

it('RB-03: a reversed invoice cannot be posted again', async () => {
  await expect(svc.clientInvoiceService.post(env.identity, { invoiceId: firstInvoiceId })).rejects.toThrow(
    /was reversed and cannot be posted again/,
  );
});

it('RB-04: a cancelled certificate draft gives up the certificate', async () => {
  const ipa = await prisma.interimPaymentApplication.create({
    data: { organizationId: env.orgId, contractId, applicationNumber: 2, status: 'SUBMITTED', createdBy: env.identity.userId },
  });
  const ipc2 = await prisma.interimPaymentCertificate.create({
    data: {
      organizationId: env.orgId,
      applicationId: ipa.id,
      certificateNumber: 1,
      status: 'CERTIFIED',
      isEffective: true,
      effectiveAt: new Date(),
      certifiedTotal: d(100_000),
      currency: 'USD',
      createdBy: env.identity.userId,
    },
  });
  const draft = await svc.clientInvoiceService.generateFromIpc(env.identity, { ipcId: ipc2.id, ...dates() });
  // Cancelled before cancelling released the tag: the row still names the certificate.
  await prisma.clientInvoice.update({ where: { id: draft.id }, data: { documentStatus: 'CANCELLED' } });

  const fresh = await svc.clientInvoiceService.generateFromIpc(env.identity, { ipcId: ipc2.id, ...dates() });
  expect(fresh.id).not.toBe(draft.id);
  expect(fresh.subtotal.toFixed(2)).toBe('20000.00'); // 100,000 to date − 80,000 already billed
  expect((await prisma.clientInvoice.findUniqueOrThrow({ where: { id: draft.id } })).sourceIpcId).toBeNull();
});
