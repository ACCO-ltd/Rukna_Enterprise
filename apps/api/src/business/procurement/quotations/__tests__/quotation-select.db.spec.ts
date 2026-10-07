import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { activateSodRules } from '../../__tests__/helpers/governance-fixture.js';
import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import {
  cleanupQuotationEnv,
  createApprovedMr,
  createQuotationEnv,
  type Persona,
  type QuotationTestEnv,
} from './helpers/quotation-fixture.js';
import { refusal, steps } from './helpers/quotation-steps.js';

/**
 * ADR-044 Q4 (live DB) — SELECT_QUOTATION segregation of duties and the selector's commands:
 * enter total, reject a quote, ask for another. Scenario S6; refusal R1.
 */
describe('ADR-044 Q4 — selecting: totals, reject, ask-another', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;
  let svc: QuotationServices;
  let s: ReturnType<typeof steps>;

  /** A persona that also holds award:quotation (to prove SoD, not permissions, refuses it). */
  const withAward = (persona: Persona): RequestIdentity => {
    const identity = env.as(persona);
    return { ...identity, permissions: [...identity.permissions, PERMISSIONS.quotationsAward] };
  };

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

  /** A sent request with three quotes from collector (and one withdrawn from collector2). */
  async function sentRequest() {
    const mr = await createApprovedMr(prisma, env);
    const request = await s.collected(mr.id);
    const extra = await s.addQuote(request.id, { storeName: 'Withdrawn Store' }, { persona: 'collector2' });
    await svc.collect.withdrawQuote(env.as('collector'), request.id, extra.quotes[3].id);
    return svc.collect.send(env.as('collector'), request.id);
  }

  it('R1: uploaders, the request creator and the MR requester cannot select — every selector command', async () => {
    const request = await sentRequest();
    const quoteId = request.quotes[0].id;
    const commands = (who: RequestIdentity) => [
      svc.selection.enterTotal(who, request.id, quoteId, '100.00'),
      svc.selection.rejectQuote(who, request.id, quoteId, 'ILLEGIBLE'),
      svc.selection.askAnother(who, request.id, 'one more please'),
    ];
    // collector: created the request and uploaded quotes. collector2: uploaded only a WITHDRAWN quote.
    for (const persona of ['collector', 'collector2'] as const) {
      for (const command of commands(withAward(persona))) {
        expect(await refusal(command)).toEqual({ status: 403, code: 'QUOTE_UPLOADER_CANNOT_SELECT' });
      }
    }
    for (const command of commands(withAward('requester'))) {
      expect(await refusal(command)).toEqual({ status: 403, code: 'REQUESTER_CANNOT_SELECT' });
    }
    // The read model tells the barred user why, with the same code.
    const asBarred = await svc.query.detail(withAward('collector2'), request.id);
    expect(asBarred.allowedActions.find((a) => a.action === 'ENTER_TOTAL')).toEqual({
      action: 'ENTER_TOTAL',
      enabled: false,
      reasonCode: 'QUOTE_UPLOADER_CANNOT_SELECT',
    });
    // Nothing was written by the refused attempts.
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).enteredTotal).toBeNull();
  });

  it('enters and overwrites totals (audited before/after); lowest follows; bad totals are refused', async () => {
    const request = await sentRequest();
    const [a, b, c] = request.quotes;
    await svc.selection.enterTotal(env.as('selector'), request.id, a.id, '2350');
    await svc.selection.enterTotal(env.as('selector'), request.id, b.id, '2410.50');
    let detail = await svc.selection.enterTotal(env.as('selector'), request.id, c.id, '2295');
    expect(detail.quotes.slice(0, 3).map((q) => [q.enteredTotal, q.isLowest])).toEqual([
      ['2350.00', false],
      ['2410.50', false],
      ['2295.00', true],
    ]);
    expect(detail.lowestTotal).toBe('2295.00');
    expect(detail.quotes[0].enteredBy?.id).toBe(env.userIds.selector);

    detail = await svc.selection.enterTotal(env.as('selector2'), request.id, a.id, '2200.00');
    expect(detail.quotes[0]).toMatchObject({ enteredTotal: '2200.00', isLowest: true });
    const audits = await prisma.auditLog.findMany({
      where: { resourceId: request.id, sourceCommand: 'quotation.enter-total' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.at(-1)?.before).toEqual({ quoteId: a.id, enteredTotal: '2350' });
    expect(audits.at(-1)?.after).toMatchObject({ quoteId: a.id, enteredTotal: '2200.00' });

    for (const bad of ['0', '-1', '12.345', 'abc', '1000000000']) {
      expect(await refusal(svc.selection.enterTotal(env.as('selector'), request.id, a.id, bad))).toEqual({
        status: 400,
        code: 'TOTAL_INVALID',
      });
    }
    // A withdrawn quote cannot be priced.
    const withdrawn = request.quotes[3];
    expect(await refusal(svc.selection.enterTotal(env.as('selector'), request.id, withdrawn.id, '10'))).toEqual({
      status: 409,
      code: 'QUOTE_NOT_ACTIVE',
    });
  });

  it('a total cannot be entered before the request is sent', async () => {
    const mr = await createApprovedMr(prisma, env);
    const request = await s.collected(mr.id, ['Hodan']);
    expect(await refusal(svc.selection.enterTotal(env.as('selector'), request.id, request.quotes[0].id, '10'))).toEqual({
      status: 409,
      code: 'QUOTATION_NOT_AWAITING_DECISION',
    });
  });

  it('a collector cannot enter a total (permission)', async () => {
    const request = await sentRequest();
    expect(await refusal(svc.selection.enterTotal(env.as('collector'), request.id, request.quotes[0].id, '10'))).toEqual({
      status: 403,
      code: 'MISSING_PERMISSION',
    });
  });

  it('reject removes the quote from the counts and from lowest', async () => {
    const request = await sentRequest();
    const [a, b, c] = request.quotes;
    await svc.selection.enterTotal(env.as('selector'), request.id, a.id, '300');
    await svc.selection.enterTotal(env.as('selector'), request.id, b.id, '200');
    await svc.selection.enterTotal(env.as('selector'), request.id, c.id, '100');
    const detail = await svc.selection.rejectQuote(env.as('selector'), request.id, c.id, 'WRONG_ITEMS', 'Quoted 10mm rebar');
    const rejected = detail.quotes.find((q) => q.id === c.id)!;
    expect(rejected).toMatchObject({ status: 'REJECTED', rejectReason: 'WRONG_ITEMS', rejectNote: 'Quoted 10mm rebar', isLowest: false });
    expect(detail.quotes.find((q) => q.id === b.id)!.isLowest).toBe(true);
    expect(detail.quoteCount).toBe(2);
    expect(detail.distinctSupplierCount).toBe(2);
  });

  it('S6: ask for another → RETURNED with the note; the collector adds a quote and sends again (sendCount 2)', async () => {
    const request = await sentRequest();
    expect(await refusal(svc.selection.askAnother(env.as('selector'), request.id, '   '))).toEqual({
      status: 400,
      code: 'NOTE_REQUIRED',
    });
    const returned = await svc.selection.askAnother(env.as('selector'), request.id, 'Check Xamar Steel too');
    expect(returned).toMatchObject({ status: 'RETURNED', returnNote: 'Check Xamar Steel too', sendCount: 1 });
    expect(returned.returnedBy?.id).toBe(env.userIds.selector);
    expect(returned.decidedAt).not.toBeNull();
    expect(returned.waitingWorkingMinutes).toBeNull();

    await s.addQuote(request.id, { storeName: 'Xamar Steel' });
    const resent = await svc.collect.send(env.as('collector'), request.id);
    expect(resent).toMatchObject({ status: 'AWAITING_DECISION', sendCount: 2, quoteCount: 4 });
    expect(resent.decidedAt).toBeNull();
    expect(await s.events(request.id)).toEqual(
      expect.arrayContaining(['QUOTATION_RETURNED', 'QUOTATION_SENT']),
    );
  });
});
