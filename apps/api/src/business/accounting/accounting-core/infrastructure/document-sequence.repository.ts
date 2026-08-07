import { Injectable } from '@nestjs/common';
import { InternalServerErrorException } from '@nestjs/common';
import type { TxClient } from '../application/ports/accounting-posting.port.js';

export interface AllocatedNumber {
  formattedNumber: string;
  rawNumber: number;
}

@Injectable()
export class DocumentSequenceRepository {
  /**
   * Atomically claim the next number from the sequence using UPDATE ... RETURNING.
   * Must be called inside a transaction to be safe under concurrency.
   */
  async claimNext(
    tx: TxClient,
    organizationId: string,
    documentType: string,
    journalCategory?: string,
  ): Promise<AllocatedNumber> {
    const rows = await tx.$queryRaw<
      { prefix: string; allocated: number; padding_length: number }[]
    >`
      UPDATE document_number_sequences
      SET next_number = next_number + 1,
          version = version + 1
      WHERE organization_id = ${organizationId}
        AND document_type = ${documentType}::"DocumentType"
        AND (journal_category = ${journalCategory ?? null}::"JournalCategory" OR journal_category IS NULL)
        AND status = 'ACTIVE'
      RETURNING prefix, next_number - 1 AS allocated, padding_length
    `;

    if (rows.length === 0) {
      throw new InternalServerErrorException(
        `No active document number sequence found for ${documentType}${journalCategory ? '/' + journalCategory : ''}`,
      );
    }

    const { prefix, allocated, padding_length } = rows[0];
    const padded = String(allocated).padStart(padding_length, '0');
    return { formattedNumber: `${prefix}${padded}`, rawNumber: allocated };
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
