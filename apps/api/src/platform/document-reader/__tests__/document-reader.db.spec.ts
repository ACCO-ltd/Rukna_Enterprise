/**
 * Step 7 — the photo reader, with a stand-in provider (the real one is OpenRouter).
 *
 *   RD-01  off until an administrator turns it on; cannot be turned on with no provider configured
 *   RD-02  a reading pre-fills from the provider's answer, and is logged; nothing else is written
 *   RD-03  a failure and an unreadable answer are logged too; per-kind permission; photos only
 */

import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@erp/types';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../../business/accounting/__tests__/helpers/fixture.factory';
import { PlatformFileService } from '../../files/application/platform-file.service';
import { PlatformFileRepository } from '../../files/infrastructure/platform-file.repository';
import { FileAuthorizationService } from '../../files/application/file-authorization.service';
import { DocumentReaderService } from '../application/document-reader.service';
import { ReaderProviderError, type DocumentReaderProvider } from '../application/reader-provider.port';
import { DocumentReaderRepository } from '../infrastructure/document-reader.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let answer: () => Promise<string>;
let available = true;
const prompts: string[] = [];
const provider: DocumentReaderProvider = {
  label: 'Stand-in',
  isAvailable: () => available,
  model: () => 'stand-in/vision',
  read: async (image, prompt) => {
    prompts.push(prompt);
    expect(image.bytes.toString()).toBe('jpeg-bytes');
    return answer();
  },
};
let reader: DocumentReaderService;
const fileIds: string[] = [];

async function photo(mimeType = 'image/jpeg'): Promise<string> {
  const f = await prisma.platformFile.create({
    data: {
      organizationId: env.orgId, originalName: 'note.jpg', mimeType, sizeBytes: 1000, storageBucket: 'test',
      storageKey: `rd-spec/${env.orgId}/${fileIds.length}-${Date.now()}`, status: 'READY', uploadedBy: env.identity.userId,
    },
  });
  fileIds.push(f.id);
  return f.id;
}

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  const tenancy = { getClient: () => prisma } as never;
  const fileAuth = new FileAuthorizationService(tenancy, { assertMember: async () => undefined } as never);
  const files = new PlatformFileService(tenancy, new PlatformFileRepository(), { get: () => 'test' } as never, fileAuth, {
    getObject: async () => Buffer.from('jpeg-bytes'),
  } as never);
  reader = new DocumentReaderService(provider, new DocumentReaderRepository(tenancy), files, fileAuth, { record: async () => undefined } as never);
}, 60_000);

afterAll(async () => {
  await prisma.documentReading.deleteMany({ where: { organizationId: env.orgId } });
  await prisma.documentReaderPolicy.deleteMany({ where: { organizationId: env.orgId } });
  await prisma.platformFile.deleteMany({ where: { id: { in: fileIds } } });
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('RD-01: off until an administrator turns it on; not without a provider', async () => {
  const id = await photo();
  expect(await reader.status(env.identity)).toMatchObject({ available: true, enabled: false, provider: 'Stand-in' });
  await expect(reader.read(env.identity, id, 'DELIVERY_NOTE')).rejects.toMatchObject({ response: { errorCode: 'READER_DISABLED' } });

  available = false;
  await expect(reader.setEnabled(env.identity, true)).rejects.toMatchObject({ response: { errorCode: 'READER_NOT_CONFIGURED' } });
  available = true;
  expect(await reader.setEnabled(env.identity, true)).toMatchObject({ enabled: true });
});

it('RD-02: a reading pre-fills from the answer and is logged', async () => {
  const id = await photo();
  answer = async () => '```json\n{"supplierName":"Horn Cement","documentNumber":"DN-55","date":"2026-10-05","lines":[{"description":"Cement 50kg","quantity":"20","unit":"bag"}]}\n```';
  const r = await reader.read({ ...env.identity, permissions: [PERMISSIONS.goodsReceiptsCreate] }, id, 'DELIVERY_NOTE');
  expect(r).toMatchObject({ kind: 'DELIVERY_NOTE', supplierName: 'Horn Cement', documentNumber: 'DN-55', date: '2026-10-05' });
  expect(r.lines).toEqual([{ description: 'Cement 50kg', quantity: '20', unit: 'bag', unitPrice: null, amount: null }]);
  expect(prompts.at(-1)).toContain('delivery note');
  const log = await prisma.documentReading.findUniqueOrThrow({ where: { id: r.readingId } });
  expect(log).toMatchObject({ status: 'SUCCEEDED', provider: 'Stand-in', model: 'stand-in/vision', platformFileId: id, createdBy: env.identity.userId });
});

it('RD-03: failures are logged; each kind has its permission; photos only', async () => {
  const id = await photo();
  answer = async () => { throw new ReaderProviderError('RATE_LIMITED', 'busy'); };
  await expect(reader.read(env.identity, id, 'RECEIPT')).rejects.toMatchObject({ status: 429, response: { errorCode: 'READER_RATE_LIMITED' } });
  answer = async () => 'I cannot read this.';
  await expect(reader.read(env.identity, id, 'RECEIPT')).rejects.toMatchObject({ response: { errorCode: 'READER_UNREADABLE' } });
  const failed = await prisma.documentReading.findMany({ where: { platformFileId: id }, orderBy: { createdAt: 'asc' } });
  expect(failed.map((f) => [f.status, f.errorCode])).toEqual([['FAILED', 'RATE_LIMITED'], ['FAILED', 'UNREADABLE_ANSWER']]);

  // A storekeeper fills delivery notes, not finance's receipts.
  await expect(reader.read({ ...env.identity, permissions: [PERMISSIONS.goodsReceiptsCreate] }, id, 'RECEIPT')).rejects.toMatchObject({ status: 403 });
  await expect(reader.read(env.identity, await photo('application/pdf'), 'RECEIPT')).rejects.toMatchObject({ response: { errorCode: 'NOT_AN_IMAGE' } });
});
