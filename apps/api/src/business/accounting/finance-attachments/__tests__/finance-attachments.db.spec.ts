/**
 * Step 4 — attachments on finance documents.
 *
 *   FA-01  a file on a draft invoice is listed, removable, and its bytes are discarded on removal
 *   FA-02  a file added to a posted invoice is kept for good: flagged, frozen, removal refused
 *   FA-03  each document kind is changed only by the permission that runs it; files must be your own
 *   FA-04  the file's bytes are readable by view:accounting, not by a clerk of another ledger
 */

import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@erp/types';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { FinanceAttachmentService } from '../application/finance-attachment.service';
import { FinanceAttachmentRepository } from '../infrastructure/finance-attachment.repository';
import { PlatformFileService } from '../../../../platform/files/application/platform-file.service';
import { PlatformFileRepository } from '../../../../platform/files/infrastructure/platform-file.repository';
import { FileAuthorizationService } from '../../../../platform/files/application/file-authorization.service';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let attachments: FinanceAttachmentService;
let fileAuth: FileAuthorizationService;
const deletedObjects: string[] = [];
const fileIds: string[] = [];
let draftInvoiceId: string;
let postedInvoiceId: string;

async function upload(uploadedBy = env.identity.userId): Promise<string> {
  const row = await prisma.platformFile.create({
    data: {
      organizationId: env.orgId,
      originalName: 'delivery-note.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      storageBucket: 'test',
      storageKey: `fa-spec/${env.orgId}/${fileIds.length}-${Date.now()}`,
      status: 'READY',
      uploadedBy,
    },
  });
  fileIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  const tenancy = { getClient: () => prisma } as never;
  fileAuth = new FileAuthorizationService(tenancy, { assertMember: async () => undefined } as never);
  const files = new PlatformFileService(
    tenancy,
    new PlatformFileRepository(),
    { get: () => 'test' } as never,
    fileAuth,
    { deleteObject: async (_bucket: string, key: string) => { deletedObjects.push(key); } } as never,
  );
  attachments = new FinanceAttachmentService(tenancy, files, new FinanceAttachmentRepository());

  for (const [code, name, accountClass, subtype] of [
    ['42100', 'Equipment hire income', 'INCOME', 'OTHER_INCOME'],
  ] as const) {
    const a = await prisma.account.create({ data: { id: `${env.orgId}-${code}`, organizationId: env.orgId, code, normalBalance: 'CREDIT', createdBy: env.identity.userId } });
    await prisma.accountVersion.create({
      data: { accountId: a.id, versionNumber: 1, name, accountClass, accountSubtype: subtype, isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2020-01-01'), changedBy: env.identity.userId },
    });
  }
  const day = env.periods.openStart.toISOString().slice(0, 10);
  const manual = {
    clientId: env.clientId, invoiceDate: day, dueDate: day, currencyCode: 'USD', paymentTerms: 'Due on receipt',
    lines: [{ description: 'Crane hire', quantity: '1', unitPrice: '100.00', revenueAccountCode: '42100' }],
  };
  draftInvoiceId = (await svc.clientInvoiceService.createManual(env.identity, manual)).id;
  postedInvoiceId = (await svc.clientInvoiceService.createManual(env.identity, manual)).id;
  await svc.clientInvoiceService.issue(env.identity, postedInvoiceId);
}, 60_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.platformFile.deleteMany({ where: { id: { in: fileIds } } });
  await prisma.$disconnect();
});

const clerk = () => ({ ...env.identity, permissions: [PERMISSIONS.receivablesManage] });

it('FA-01: a draft invoice’s file is listed, removable, and discarded when removed', async () => {
  const fileId = await upload();
  const added = await attachments.attach(clerk(), 'INVOICE', draftInvoiceId, fileId);
  expect(added).toMatchObject({ fileId, fileName: 'delivery-note.pdf', addedAfterPosting: false, locked: false });
  expect((await prisma.platformFile.findUnique({ where: { id: fileId } }))?.lifecycle).toBe('BOUND');

  const listed = await attachments.list(clerk(), 'INVOICE', draftInvoiceId);
  expect(listed.map((x) => x.id)).toEqual([added.id]);

  await attachments.remove(clerk(), 'INVOICE', draftInvoiceId, added.id);
  expect(await attachments.list(clerk(), 'INVOICE', draftInvoiceId)).toEqual([]);
  expect(await prisma.platformFile.findUnique({ where: { id: fileId } })).toBeNull();
  expect(deletedObjects).toHaveLength(1);
});

it('FA-02: a file added to a posted invoice is kept for good', async () => {
  const fileId = await upload();
  const added = await attachments.attach(clerk(), 'INVOICE', postedInvoiceId, fileId);
  expect(added).toMatchObject({ addedAfterPosting: true, locked: true });
  expect((await prisma.platformFile.findUnique({ where: { id: fileId } }))?.lifecycle).toBe('IMMUTABLE');

  await expect(attachments.remove(clerk(), 'INVOICE', postedInvoiceId, added.id)).rejects.toMatchObject({
    response: { errorCode: 'ATTACHMENT_FROZEN' },
  });
});

it('FA-03: permission per document kind, scoped ownership, own uploads only', async () => {
  const fileId = await upload();
  const payablesOnly = { ...env.identity, permissions: [PERMISSIONS.payablesManage] };
  await expect(attachments.attach(payablesOnly, 'INVOICE', draftInvoiceId, fileId)).rejects.toMatchObject({ status: 403 });
  // A reader of the books can list but not change.
  const auditor = { ...env.identity, permissions: [PERMISSIONS.accountingView] };
  await expect(attachments.list(auditor, 'INVOICE', draftInvoiceId)).resolves.toEqual([]);
  await expect(attachments.attach(auditor, 'INVOICE', draftInvoiceId, fileId)).rejects.toMatchObject({ status: 403 });
  // An id that is not this organization's document is not found, whatever its kind.
  await expect(attachments.attach(clerk(), 'RECEIPT', draftInvoiceId, fileId)).rejects.toMatchObject({
    response: { errorCode: 'DOCUMENT_NOT_FOUND' },
  });
  const someoneElses = await upload('another-user');
  await expect(attachments.attach(clerk(), 'INVOICE', draftInvoiceId, someoneElses)).rejects.toMatchObject({
    response: { errorCode: 'FILE_NOT_YOURS' },
  });
});

it('FA-04: the bytes follow the document’s read rule', async () => {
  const fileId = await upload();
  await attachments.attach(clerk(), 'INVOICE', draftInvoiceId, fileId);
  const other = { ...env.identity, userId: 'someone-else' };
  await expect(fileAuth.assertCanRead({ ...other, permissions: [PERMISSIONS.accountingView] }, fileId)).resolves.toBeDefined();
  await expect(fileAuth.assertCanRead({ ...other, permissions: [PERMISSIONS.payablesManage] }, fileId)).rejects.toMatchObject({ status: 403 });
});
