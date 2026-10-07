import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import {
  cleanupQuotationEnv,
  createApprovedMr,
  createQuotationEnv,
  type QuotationTestEnv,
} from './helpers/quotation-fixture.js';
import { refusal, steps } from './helpers/quotation-steps.js';

/**
 * Quote photos carry supplier prices (ADR-044 §5, hardened): their bytes — as a QUOTATION_PHOTO
 * and as the PO's quotation evidence — need view:procurement AND view:commitment-ledger. The read
 * models omit photo ids for everyone else and say so (`photosVisible: false`).
 */
describe('quotation photo access', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;
  let svc: QuotationServices;
  let s: ReturnType<typeof steps>;
  let requestId: string;
  let purchaseOrderId: string;
  let photoFileId: string;

  /** A selector who awards but has no cost visibility. */
  const awardOnly = (): RequestIdentity => ({
    ...env.as('selector2'),
    permissions: [PERMISSIONS.procurementView, PERMISSIONS.quotationsAward],
  });

  beforeAll(async () => {
    env = await createQuotationEnv(prisma);
    svc = buildQuotationServices(prisma);
    s = steps(prisma, env, svc);
    const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 1, estimate: 90 }] });
    const request = await s.collected(mr.id, ['Hodan']);
    await svc.collect.send(env.as('collector'), request.id);
    await svc.selection.enterTotal(env.as('selector'), request.id, request.quotes[0].id, '90');
    await svc.awards.award(env.as('selector'), request.id, {
      quoteId: request.quotes[0].id,
      paymentPath: 'BUYER_CASH',
      awardSupplierId: env.supplierId,
    });
    ({ purchaseOrderId } = await svc.orders.raiseOrder(env.as('collector'), request.id, {}));
    requestId = request.id;
    photoFileId = request.quotes[0].photos[0].fileId;
  });

  afterAll(async () => {
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  it('downloading the photo (quote photo AND PO evidence) needs cost visibility; money-blind roles get 403', async () => {
    const owners = (await svc.fileAuth.resolveOwnership(env.as('collector'), photoFileId)).owners.map((o) => o.kind);
    expect(owners.sort()).toEqual(['PO_REVISION_ATTACHMENT', 'QUOTATION_PHOTO']);
    for (const persona of ['collector', 'selector', 'cfo', 'director'] as const) {
      await expect(svc.fileAuth.assertCanRead(env.as(persona), photoFileId)).resolves.toBeTruthy();
    }
    // The PM holds view:procurement, which still opens ordinary PO attachments — not this one.
    expect((await refusal(svc.fileAuth.assertCanRead(env.as('pm'), photoFileId))).status).toBe(403);
    expect((await refusal(svc.fileAuth.assertCanRead(env.as('requester'), photoFileId))).status).toBe(403);
    expect((await refusal(svc.fileAuth.assertCanRead(awardOnly(), photoFileId))).status).toBe(403);
  });

  it('the detail omits photo ids, hashes and reuse links unless the caller may download them', async () => {
    const hidden = await svc.query.detail(env.as('pm'), requestId);
    expect(hidden.photosVisible).toBe(false);
    expect(hidden.quotes[0]).toMatchObject({ photos: [], photoCount: 1 });

    const alsoHidden = await svc.query.detail(awardOnly(), requestId);
    expect(alsoHidden).toMatchObject({ photosVisible: false, moneyVisible: true });
    expect(alsoHidden.quotes[0].photos).toEqual([]);

    const shown = await svc.query.detail(env.as('selector'), requestId);
    expect(shown.photosVisible).toBe(true);
    expect(shown.quotes[0].photoCount).toBe(1);
    expect(shown.quotes[0].photos.map((p) => p.fileId)).toEqual([photoFileId]);
  });

  it('the PO attachment list hides the quotation evidence from money-blind callers', async () => {
    const forPm = await svc.poService.listRevisionAttachments(env.as('pm'), purchaseOrderId);
    expect(forPm).toEqual([]);
    const forCollector = await svc.poService.listRevisionAttachments(env.as('collector'), purchaseOrderId);
    expect(forCollector).toHaveLength(1);
    expect(forCollector[0]).toMatchObject({ platformFileId: photoFileId, purpose: 'QUOTATION', quotationEvidence: true });
    expect(forCollector[0].file).not.toHaveProperty('quotePhoto');
  });
});
