import { Injectable } from '@nestjs/common';
import { InternalServerErrorException } from '@nestjs/common';
import type { TxClient } from '../application/ports/accounting-posting.port.js';
import { formatDocumentNumber, periodKey, type NumberResetPolicy } from '../domain/document-number-format.js';

export interface AllocatedNumber {
  formattedNumber: string;
  rawNumber: number;
}

@Injectable()
export class DocumentSequenceRepository {
  /**
   * Atomically claim the next number from the sequence. The UPDATE ... RETURNING takes the sequence
   * row's lock, so concurrent claims queue behind it; must be called inside a transaction.
   *
   * CI-8 — a sequence that restarts each year, month or day counts the document's period on its own
   * row (`documentDate`, else today): the running `next_number` is left as it is and the period's
   * counter is claimed under the same lock, so each period is gapless too. A rolled-back claim burns
   * nothing in either case.
   */
  async claimNext(
    tx: TxClient,
    organizationId: string,
    documentType: string,
    journalCategory?: string,
    documentDate?: Date,
  ): Promise<AllocatedNumber> {
    const rows = await tx.$queryRaw<
      { id: string; prefix: string; allocated: number; padding_length: number; reset_policy: NumberResetPolicy }[]
    >`
      UPDATE document_number_sequences
      SET next_number = CASE WHEN reset_policy = 'NEVER' THEN next_number + 1 ELSE next_number END,
          version = version + 1
      WHERE organization_id = ${organizationId}
        AND document_type = ${documentType}::"DocumentType"
        AND (journal_category = ${journalCategory ?? null}::"JournalCategory" OR journal_category IS NULL)
        AND status = 'ACTIVE'
      RETURNING id, prefix, next_number - 1 AS allocated, padding_length, reset_policy
    `;

    if (rows.length === 0) {
      throw new InternalServerErrorException(
        `No active document number sequence found for ${documentType}${journalCategory ? '/' + journalCategory : ''}`,
      );
    }

    const { id, prefix, allocated, padding_length, reset_policy } = rows[0];
    const format = { prefix, resetPolicy: reset_policy, paddingLength: padding_length };
    if (reset_policy === 'NEVER') {
      return { formattedNumber: formatDocumentNumber(format, '', allocated), rawNumber: allocated };
    }
    const period = periodKey(reset_policy, documentDate ?? new Date());
    const counter = await tx.documentNumberPeriodCounter.upsert({
      where: { sequenceId_periodKey: { sequenceId: id, periodKey: period } },
      create: { organizationId, sequenceId: id, periodKey: period, nextNumber: 2 },
      update: { nextNumber: { increment: 1 } },
      select: { nextNumber: true },
    });
    const count = counter.nextNumber - 1;
    return { formattedNumber: formatDocumentNumber(format, period, count), rawNumber: count };
  }

  /** CI-8 — a sequence's format and its counters, for the numbering setting. Null before setup. */
  findSequence(prisma: TxClient, organizationId: string, documentType: string) {
    return prisma.documentNumberSequence.findFirst({
      where: { organizationId, documentType: documentType as never, journalCategory: null },
      include: { periodCounters: { select: { periodKey: true, nextNumber: true } } },
    });
  }

  /**
   * CI-8 — save a sequence's format and the next number of the period `period` ('' = the running
   * count). Run in a transaction; the version bump serialises it with a claim in flight.
   */
  async saveFormat(
    tx: TxClient,
    sequenceId: string,
    organizationId: string,
    format: { prefix: string; resetPolicy: NumberResetPolicy; paddingLength: number },
    period: string,
    nextNumber: number,
  ): Promise<void> {
    await tx.documentNumberSequence.update({
      where: { id: sequenceId },
      data: {
        prefix: format.prefix,
        resetPolicy: format.resetPolicy,
        paddingLength: format.paddingLength,
        ...(period === '' ? { nextNumber } : {}),
        version: { increment: 1 },
      },
    });
    if (period !== '') {
      await tx.documentNumberPeriodCounter.upsert({
        where: { sequenceId_periodKey: { sequenceId, periodKey: period } },
        create: { organizationId, sequenceId, periodKey: period, nextNumber },
        update: { nextNumber },
      });
    }
  }

  /** CI-8 — invoice numbers already taken that start with `stem`, for the next-number guard. */
  async invoiceNumbersStartingWith(prisma: TxClient, organizationId: string, stem: string): Promise<string[]> {
    const rows = await prisma.clientInvoice.findMany({
      where: { organizationId, invoiceNumber: { startsWith: stem } },
      select: { invoiceNumber: true },
    });
    return rows.map((r) => r.invoiceNumber).filter((n): n is string => n !== null);
  }

  async ensureSequence(
    tx: TxClient,
    organizationId: string,
    documentType: string,
    prefix: string,
    journalCategory?: string,
  ): Promise<void> {
    if (!journalCategory) {
      // Prisma upsert cannot filter by null in composite unique keys.
      // Use findFirst + create to avoid the validation error.
      const existing = await tx.documentNumberSequence.findFirst({
        where: { organizationId, documentType: documentType as never, journalCategory: null },
      });
      if (!existing) {
        try {
          await tx.documentNumberSequence.create({
            data: {
              organizationId,
              documentType: documentType as never,
              journalCategory: null,
              prefix,
              nextNumber: 1,
              paddingLength: 6,
              status: 'ACTIVE',
            },
          });
        } catch {
          // Concurrent creation — sequence already exists, safe to ignore
        }
      }
      return;
    }

    await tx.documentNumberSequence.upsert({
      where: {
        organizationId_documentType_journalCategory: {
          organizationId,
          documentType: documentType as never,
          journalCategory: journalCategory as never,
        },
      },
      create: {
        organizationId,
        documentType: documentType as never,
        journalCategory: journalCategory as never,
        prefix,
        nextNumber: 1,
        paddingLength: 6,
        status: 'ACTIVE',
      },
      update: {},
    });
  }
}
