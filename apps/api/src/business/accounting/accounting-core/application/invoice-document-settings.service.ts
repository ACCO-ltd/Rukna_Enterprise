import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  InvoiceDocumentPolicyRepository,
  type InvoiceDocumentPolicyWrite,
} from '../infrastructure/invoice-document-policy.repository.js';

/** The standard invoice notes, shown on invoices while the organisation has written none. */
export const DEFAULT_INVOICE_NOTES = [
  'Please quote the invoice number in your payment.',
  'This invoice is issued in accordance with the project contract.',
  'Payment is due within <payment terms> days from the invoice date. (Printed when the invoice has terms.)',
];

export const INVOICE_NOTES_MAX_LENGTH = 2000;

export interface InvoiceDocumentSettingsView {
  bankAccountId: string | null;
  /** The organisation's own notes (one per line), or null while it uses the defaults. */
  notes: string | null;
  defaultNotes: string[];
  signatoryUserId: string | null;
  signatoryTitle: string | null;
  updatedAt: string | null;
}

export interface UpdateInvoiceDocumentSettingsInput {
  bankAccountId?: string | null;
  notes?: string | null;
  signatoryUserId?: string | null;
  signatoryTitle?: string | null;
}

const invalid = (message: string) =>
  new UnprocessableEntityException({ errorCode: 'INVOICE_SETTINGS_INVALID', message });

/**
 * What the client invoice PDF prints beyond the invoice itself — the bank account clients pay
 * into, the notes, the authorised signatory. Finance (`manage:accounting`) maintains them; an
 * invoice freezes their resolved values when it is raised and again when it is issued (see
 * ClientInvoiceService.snapshotOrgBranding), so editing these never changes a document already
 * generated.
 */
@Injectable()
export class InvoiceDocumentSettingsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: InvoiceDocumentPolicyRepository,
  ) {}

  async get(identity: RequestIdentity): Promise<InvoiceDocumentSettingsView> {
    const policy = await this.repo.find(this.tenancy.getClient(), identity.activeOrganizationId);
    return {
      bankAccountId: policy?.bankAccountId ?? null,
      notes: policy?.notes ?? null,
      defaultNotes: DEFAULT_INVOICE_NOTES,
      signatoryUserId: policy?.signatoryUserId ?? null,
      signatoryTitle: policy?.signatoryTitle ?? null,
      updatedAt: policy?.updatedAt.toISOString() ?? null,
    };
  }

  /** Replace the fields given; an omitted field keeps its value, `null` / blank clears it. */
  async update(
    identity: RequestIdentity,
    input: UpdateInvoiceDocumentSettingsInput,
  ): Promise<InvoiceDocumentSettingsView> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const before = await this.repo.find(prisma, orgId);

    const next: InvoiceDocumentPolicyWrite = {
      bankAccountId: pick(input.bankAccountId, before?.bankAccountId),
      notes: pick(input.notes, before?.notes),
      signatoryUserId: pick(input.signatoryUserId, before?.signatoryUserId),
      signatoryTitle: pick(input.signatoryTitle, before?.signatoryTitle),
    };

    if (next.notes && next.notes.length > INVOICE_NOTES_MAX_LENGTH) {
      throw invalid(`Invoice notes are limited to ${INVOICE_NOTES_MAX_LENGTH} characters.`);
    }
    if (next.bankAccountId && next.bankAccountId !== before?.bankAccountId) {
      const bank = await prisma.bankAccount.findFirst({
        where: { id: next.bankAccountId, organizationId: orgId },
        select: { status: true, allowsReceipts: true, accountName: true },
      });
      if (!bank) throw invalid('That bank account was not found.');
      if (bank.status !== 'ACTIVE' || !bank.allowsReceipts) {
        throw invalid(`${bank.accountName} is not an active account that accepts receipts.`);
      }
    }
    if (next.signatoryUserId && next.signatoryUserId !== before?.signatoryUserId) {
      const user = await prisma.user.findFirst({
        where: { id: next.signatoryUserId, organizationId: orgId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!user) throw invalid('The signatory must be an active user of this organisation.');
    }
    if (!next.signatoryUserId) next.signatoryTitle = null;

    await prisma.$transaction(async (tx) => {
      await this.repo.upsert(tx, orgId, next, identity.userId);
      await this.repo.recordAudit(tx, {
        organizationId: orgId,
        userId: identity.userId,
        before: before
          ? {
              bankAccountId: before.bankAccountId,
              notes: before.notes,
              signatoryUserId: before.signatoryUserId,
              signatoryTitle: before.signatoryTitle,
            }
          : null,
        after: next,
      });
    });
    return this.get(identity);
  }
}

/** `undefined` keeps the current value; `null` or blank text clears it; text is trimmed. */
function pick(value: string | null | undefined, current: string | null | undefined): string | null {
  if (value === undefined) return current ?? null;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
