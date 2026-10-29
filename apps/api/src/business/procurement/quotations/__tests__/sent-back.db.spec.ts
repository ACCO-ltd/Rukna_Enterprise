import { PrismaClient } from '@prisma/client';

import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import { cleanupQuotationEnv, createApprovedMr, createQuotationEnv, type QuotationTestEnv } from './helpers/quotation-fixture.js';
import { steps } from './helpers/quotation-steps.js';
import { SentBackService } from '../application/sent-back.service.js';
import { SentBackRepository } from '../infrastructure/sent-back.repository.js';

/**
 * Step 7 — the phone Home's "sent back" list.
 *
 *   SB-01  a rejected quote and a round sent back for another quote show for their collector,
 *          newest first, with the reason and note; not for anyone else
 *   SB-02  once a newer quote is added to the round, the rejected one no longer shows
 */
describe('Step 7 — sent back', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;
  let svc: QuotationServices;
  let s: ReturnType<typeof steps>;
  let sentBack: SentBackService;

  beforeAll(async () => {
    env = await createQuotationEnv(prisma);
    svc = buildQuotationServices(prisma);
    s = steps(prisma, env, svc);
    sentBack = new SentBackService(new SentBackRepository({ getClient: () => prisma } as never));
  });

  afterAll(async () => {
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  it('SB-01 / SB-02: rejected quotes and returned rounds, for their collector only; a replacement clears it', async () => {
    const mr = await createApprovedMr(prisma, env);
    const request = await s.collected(mr.id);
    const sent = await svc.collect.send(env.as('collector'), request.id);
    const rejected = sent.quotes[0];
    await svc.selection.rejectQuote(env.as('selector'), sent.id, rejected.id, 'ILLEGIBLE', 'Too blurry to read');
    await svc.selection.askAnother(env.as('selector'), sent.id, 'One more quote please');

    const mine = await sentBack.list(env.as('collector'));
    expect(mine.map((i) => i.kind).sort()).toEqual(['QUOTATION_RETURNED', 'QUOTE_REJECTED']);
    expect(mine.find((i) => i.kind === 'QUOTE_REJECTED')).toMatchObject({
      id: rejected.id, quotationRequestId: sent.id, number: sent.number, reason: 'ILLEGIBLE', note: 'Too blurry to read', storeName: rejected.store.name,
    });
    expect(mine.find((i) => i.kind === 'QUOTATION_RETURNED')).toMatchObject({ quotationRequestId: sent.id, note: 'One more quote please' });
    expect(await sentBack.list(env.as('collector2'))).toEqual([]);

    // A fresh quote goes in: the rejected one no longer needs doing.
    await s.addQuote(sent.id, { storeName: 'Fresh Store' });
    const after = await sentBack.list(env.as('collector'));
    expect(after.some((i) => i.kind === 'QUOTE_REJECTED')).toBe(false);
  });
});
