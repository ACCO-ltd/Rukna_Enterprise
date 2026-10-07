import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { activateSodRules } from '../../__tests__/helpers/governance-fixture.js';
import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import {
  cleanupQuotationEnv,
  createApprovedMr,
  createQuotationEnv,
  type QuotationTestEnv,
} from './helpers/quotation-fixture.js';
import { refusal, steps } from './helpers/quotation-steps.js';

/**
 * Review H2 — QUOTE_UPLOADER_CANNOT_SELECT covers everyone who acted on the evidence, not only
 * the uploaders: whoever withdrew a quote, sent the request (incl. with a count exception) or
 * reopened it is barred from selecting on it too.
 */
describe('collect actors are barred from selecting (review H2)', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;
  let svc: QuotationServices;
  let s: ReturnType<typeof steps>;

  /** A finance person who also holds collect:quotation. */
  const both = (): RequestIdentity => ({
    ...env.as('selector2'),
    permissions: [...env.as('selector2').permissions, PERMISSIONS.quotationsCollect],
  });

  beforeAll(async () => {
    env = await createQuotationEnv(prisma);
    svc = buildQuotationServices(prisma);
    s = steps(prisma, env, svc);
    await activateSodRules(prisma, env.orgId, ['QUOTE_UPLOADER_CANNOT_SELECT', 'REQUESTER_CANNOT_SELECT']);
  });

  afterAll(async () => {
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  const collected = async () => {
    const mr = await createApprovedMr(prisma, env);
    return s.collected(mr.id, ['Hodan', 'Bakaara']);
  };
  const barred = async (requestId: string, quoteId: string) =>
    refusal(svc.selection.enterTotal(both(), requestId, quoteId, '10'));

  it('whoever withdrew a quote cannot select (and the withdrawal is recorded)', async () => {
    const request = await collected();
    await svc.collect.withdrawQuote(both(), request.id, request.quotes[1].id);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: request.quotes[1].id } })).withdrawnBy).toBe(
      env.userIds.selector2,
    );
    await svc.collect.send(env.as('collector'), request.id, 'URGENT');
    expect(await barred(request.id, request.quotes[0].id)).toEqual({ status: 403, code: 'QUOTE_UPLOADER_CANNOT_SELECT' });
  });

  it('whoever sent the request with a count exception cannot select', async () => {
    const request = await collected();
    await svc.collect.send(both(), request.id, 'ONLY_ONE_SUPPLIER');
    expect(await barred(request.id, request.quotes[0].id)).toEqual({ status: 403, code: 'QUOTE_UPLOADER_CANNOT_SELECT' });
  });

  it('whoever reopened the request cannot select after it is re-sent', async () => {
    const request = await collected();
    await svc.collect.send(env.as('collector'), request.id, 'URGENT');
    await svc.collect.reopen(both(), request.id, 'blurred photo');
    await svc.collect.send(env.as('collector'), request.id, 'URGENT');
    expect(await barred(request.id, request.quotes[0].id)).toEqual({ status: 403, code: 'QUOTE_UPLOADER_CANNOT_SELECT' });
  });

  it('a finance person who never acted on the evidence still selects', async () => {
    const request = await collected();
    await svc.collect.send(env.as('collector'), request.id, 'URGENT');
    const detail = await svc.selection.enterTotal(both(), request.id, request.quotes[0].id, '10');
    expect(detail.quotes[0].enteredTotal).toBe('10.00');
  });
});
