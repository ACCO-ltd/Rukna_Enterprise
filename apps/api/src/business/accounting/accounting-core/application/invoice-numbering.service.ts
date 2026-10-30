import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { DocumentSequenceRepository } from '../infrastructure/document-sequence.repository.js';
import {
  formatDocumentNumber,
  highestCountUsed,
  numberFormatProblems,
  numberStem,
  periodKey,
  type NumberFormat,
  type NumberResetPolicy,
} from '../domain/document-number-format.js';

const DOCUMENT_TYPE = 'CLIENT_INVOICE';
const DEFAULT_FORMAT: NumberFormat = { prefix: 'INV-', resetPolicy: 'NEVER', paddingLength: 6 };

export interface InvoiceNumberingView extends NumberFormat {
  /** The count the next invoice dated today takes. */
  nextNumber: number;
  /** That invoice's number, e.g. "INV-2026-0001". */
  nextInvoiceNumber: string;
  updatedAt: string | null;
}

export interface UpdateInvoiceNumberingInput {
  prefix: string;
  resetPolicy: NumberResetPolicy;
  paddingLength: number;
  nextNumber: number;
}

/**
 * CI-8 — how client invoices are numbered: the prefix, whether the count restarts each year, month
 * or day (and so carries the invoice date), the digits, and the next number — e.g. to carry on from
 * the last invoice of the system Rukna replaces. The next number can never go back to one already
 * issued in that format, so a number is never given twice. Finance (`manage:accounting`) maintains
 * it; every change is audited.
 */
@Injectable()
export class InvoiceNumberingService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly sequences: DocumentSequenceRepository,
    @Optional() private readonly auditOutbox?: TransactionalAuditOutboxService,
  ) {}

  async get(identity: RequestIdentity, today = new Date()): Promise<InvoiceNumberingView> {
    const prisma = this.tenancyService.getClient();
    const sequence = await this.sequences.findSequence(prisma as never, identity.activeOrganizationId, DOCUMENT_TYPE);
    if (!sequence) return view(DEFAULT_FORMAT, 1, today, null);
    const format: NumberFormat = {
      prefix: sequence.prefix,
      resetPolicy: sequence.resetPolicy,
      paddingLength: sequence.paddingLength,
    };
    const period = periodKey(format.resetPolicy, today);
    const next =
      period === '' ? sequence.nextNumber : (sequence.periodCounters.find((c) => c.periodKey === period)?.nextNumber ?? 1);
    return view(format, next, today, sequence.updatedAt);
  }

  async update(identity: RequestIdentity, input: UpdateInvoiceNumberingInput, today = new Date()): Promise<InvoiceNumberingView> {
    const orgId = identity.activeOrganizationId;
    const format: NumberFormat = {
      prefix: input.prefix.trim(),
      resetPolicy: input.resetPolicy,
      paddingLength: input.paddingLength,
    };
    const problems = numberFormatProblems(format, input.nextNumber, today);
    if (problems.length > 0) throw invalid(problems);

    const before = await this.get(identity, today);
    const prisma = this.tenancyService.getClient();
    await prisma.$transaction(async (tx) => {
      await this.sequences.ensureSequence(tx as never, orgId, DOCUMENT_TYPE, DEFAULT_FORMAT.prefix);
      const sequence = (await this.sequences.findSequence(tx as never, orgId, DOCUMENT_TYPE))!;
      const period = periodKey(format.resetPolicy, today);
      const stem = numberStem(format, period);
      const used = highestCountUsed(stem, await this.sequences.invoiceNumbersStartingWith(tx as never, orgId, stem));
      if (input.nextNumber <= used) {
        throw invalid([
          `${formatDocumentNumber(format, period, used)} is already issued, so the next number must be ${used + 1} or higher.`,
        ]);
      }
      await this.sequences.saveFormat(tx as never, sequence.id, orgId, format, period, input.nextNumber);
      await this.auditOutbox?.record(tx as never, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'DocumentNumberSequence',
        resourceId: sequence.id,
        sourceCommand: 'accounting.updateInvoiceNumbering',
        eventType: 'INVOICE_NUMBERING_UPDATED',
        idempotencyKey: `invoice-numbering:${orgId}:${Date.now()}`,
        before: before as never,
        after: { ...format, nextNumber: input.nextNumber } as never,
      });
    });
    return this.get(identity, today);
  }
}

function view(format: NumberFormat, nextNumber: number, today: Date, updatedAt: Date | null): InvoiceNumberingView {
  return {
    ...format,
    nextNumber,
    nextInvoiceNumber: formatDocumentNumber(format, periodKey(format.resetPolicy, today), nextNumber),
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}

const invalid = (problems: string[]) =>
  new BadRequestException({ errorCode: 'INVOICE_NUMBERING_INVALID', message: problems.join(' '), details: { problems } });
