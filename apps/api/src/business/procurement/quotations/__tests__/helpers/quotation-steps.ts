/** Small, readable steps for quotation specs (open → quotes → send …). */
import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import type { QuotationServices } from './build-quotation-services.js';
import { createUploadedPhoto, type Persona, type QuotationTestEnv } from './quotation-fixture.js';

export function steps(prisma: PrismaClient, env: QuotationTestEnv, svc: QuotationServices) {
  const photo = async (persona: Persona, content?: string) => {
    const file = await createUploadedPhoto(prisma, env, persona, { content });
    return { platformFileId: file.id, capturedAt: '2026-10-07T07:31:00.000Z', source: 'CAMERA' as const };
  };

  return {
    photo,

    /** Opens (or returns) the request for `mrId` as the collector. */
    open: async (mrId: string, persona: Persona = 'collector') => (await svc.collect.open(env.as(persona), mrId)).request,

    /** Adds a one-page quote from a new store (or a registered supplier). */
    addQuote: async (
      requestId: string,
      store: { storeName: string } | { supplierId: string },
      opts: { persona?: Persona; pages?: number; content?: string; clientRef?: string } = {},
    ) => {
      const persona = opts.persona ?? 'collector';
      const photos: Array<Awaited<ReturnType<typeof photo>>> = [];
      for (let i = 0; i < (opts.pages ?? 1); i++) {
        photos.push(await photo(persona, opts.content && i === 0 ? opts.content : undefined));
      }
      return svc.collect.addQuote(env.as(persona), requestId, {
        clientRef: opts.clientRef ?? randomUUID(),
        ...store,
        photos,
      });
    },

    /** Opens a request on `mrId` and adds `stores` single-page quotes. */
    collected: async (mrId: string, stores: string[] = ['Hodan Hardware', 'Bakaara Steel', 'Xamar Supplies']) => {
      const request = await svc.collect.open(env.as('collector'), mrId);
      let detail = request.request;
      for (const storeName of stores) {
        detail = await svc.collect.addQuote(env.as('collector'), detail.id, {
          clientRef: randomUUID(),
          storeName,
          photos: [await photo('collector')],
        });
      }
      return detail;
    },

    /** The audit events recorded for a quotation request, oldest first. */
    events: async (requestId: string) =>
      (
        await prisma.auditOutboxEvent.findMany({
          where: { aggregateType: 'QuotationRequest', aggregateId: requestId },
          orderBy: { occurredAt: 'asc' },
          select: { eventType: true },
        })
      ).map((e) => e.eventType),
  };
}

/** Awaits a rejection and returns its HTTP status + machine code. */
export async function refusal(promise: Promise<unknown>): Promise<{ status: number; code: string | undefined }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { getStatus?: () => number; getResponse?: () => unknown };
    const response = (e.getResponse?.() ?? {}) as { details?: { code?: string } };
    return { status: e.getStatus?.() ?? 500, code: response.details?.code };
  }
  throw new Error('expected the command to be refused');
}
