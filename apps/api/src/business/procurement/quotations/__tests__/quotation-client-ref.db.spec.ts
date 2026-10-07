import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import { cleanupQuotationEnv, createApprovedMr, createQuotationEnv, type QuotationTestEnv } from './helpers/quotation-fixture.js';
import { refusal, steps } from './helpers/quotation-steps.js';

/** Review L5 — a clientRef replay must be the same upload; different photos are a conflict. */
describe('addQuote clientRef replay (review L5)', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;
  let svc: QuotationServices;
  let s: ReturnType<typeof steps>;

  beforeAll(async () => {
    env = await createQuotationEnv(prisma);
    svc = buildQuotationServices(prisma);
    s = steps(prisma, env, svc);
  });

  afterAll(async () => {
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  it('same clientRef + same photos replays; same clientRef + other photos is 409 CLIENT_REF_CONFLICT', async () => {
    const mr = await createApprovedMr(prisma, env);
    const request = await s.open(mr.id);
    const clientRef = randomUUID();
    const first = [await s.photo('collector')];
    await svc.collect.addQuote(env.as('collector'), request.id, { clientRef, storeName: 'Hodan', photos: first });
    const replay = await svc.collect.addQuote(env.as('collector'), request.id, { clientRef, storeName: 'Hodan', photos: first });
    expect(replay.quotes).toHaveLength(1);

    const other = [await s.photo('collector')];
    expect(
      await refusal(svc.collect.addQuote(env.as('collector'), request.id, { clientRef, storeName: 'Hodan', photos: other })),
    ).toEqual({ status: 409, code: 'CLIENT_REF_CONFLICT' });
    // The other photo was not bound.
    expect((await prisma.platformFile.findUniqueOrThrow({ where: { id: other[0].platformFileId } })).lifecycle).toBe('TEMPORARY');
  });
});
