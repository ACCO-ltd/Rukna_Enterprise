import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  InvoiceDocumentPolicyRepository,
  readPaymentAccounts,
  type InvoiceDocumentPolicyWrite,
  type InvoicePaymentAccount,
} from '../infrastructure/invoice-document-policy.repository.js';

/** The standard invoice notes, shown on invoices while the organisation has written none. */
export const DEFAULT_INVOICE_NOTES = [
  'Please quote the invoice number in your payment.',
  'This invoice is issued in accordance with the project contract.',
  'Payment is due within <payment terms> days from the invoice date. (Printed when the invoice has terms.)',
];

export const INVOICE_NOTES_MAX_LENGTH = 2000;
export const MAX_PAYMENT_ACCOUNTS = 8;
export const BANK_NAME_MAX_LENGTH = 100;
export const ACCOUNT_NUMBER_MAX_LENGTH = 50;
export const SIGNATORY_MAX_LENGTH = 120;

export interface InvoiceDocumentSettingsView {
  /** The "Bank Account Details" rows, in print order. */
  paymentAccounts: InvoicePaymentAccount[];
  /** The organisation's own notes (one per line), or null while it uses the defaults. */
  notes: string | null;
  defaultNotes: string[];
  signatoryName: string | null;
  signatoryTitle: string | null;
  updatedAt: string | null;
}

export interface UpdateInvoiceDocumentSettingsInput {
  paymentAccounts?: Array<{ bankName: string; accountNumber: string }>;
  notes?: string | null;
  signatoryName?: string | null;
  signatoryTitle?: string | null;
}

const invalid = (message: string) =>
  new UnprocessableEntityException({ errorCode: 'INVOICE_SETTINGS_INVALID', message });

/**
 * What the client invoice PDF prints beyond the invoice itself — the "Bank Account Details" table
 * (typed bank name + account number rows), the notes and the authorised signatory's name and
 * title. Finance (`manage:accounting`) maintains them; an invoice freezes them when it is raised and
 * again when it is issued (ClientInvoiceService.snapshotOrgBranding), so editing these never changes
 * a document already generated.
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
      paymentAccounts: readPaymentAccounts(policy?.paymentAccounts),
      notes: policy?.notes ?? null,
      defaultNotes: DEFAULT_INVOICE_NOTES,
      signatoryName: policy?.signatoryName ?? null,
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
      paymentAccounts:
        input.paymentAccounts === undefined
          ? readPaymentAccounts(before?.paymentAccounts)
          : validatePaymentAccounts(input.paymentAccounts),
      notes: pick(input.notes, before?.notes),
      signatoryName: pick(input.signatoryName, before?.signatoryName),
      signatoryTitle: pick(input.signatoryTitle, before?.signatoryTitle),
    };

    if (next.notes && next.notes.length > INVOICE_NOTES_MAX_LENGTH) {
      throw invalid(`Invoice notes are limited to ${INVOICE_NOTES_MAX_LENGTH} characters.`);
    }
    for (const [field, value] of [
      ['Signatory name', next.signatoryName],
      ['Signatory title', next.signatoryTitle],
    ] as const) {
      if (value && value.length > SIGNATORY_MAX_LENGTH) {
        throw invalid(`${field} is limited to ${SIGNATORY_MAX_LENGTH} characters.`);
      }
    }

    await prisma.$transaction(async (tx) => {
      await this.repo.upsert(tx, orgId, next, identity.userId);
      await this.repo.recordAudit(tx, {
        organizationId: orgId,
        userId: identity.userId,
        before: before
          ? {
              paymentAccounts: readPaymentAccounts(before.paymentAccounts),
              notes: before.notes,
              signatoryName: before.signatoryName,
              signatoryTitle: before.signatoryTitle,
            }
          : null,
        after: next,
      });
    });
    return this.get(identity);
  }
}

/** Every row needs both a bank name and an account number (trimmed); at most eight rows. */
export function validatePaymentAccounts(
  rows: Array<{ bankName?: unknown; accountNumber?: unknown }>,
): InvoicePaymentAccount[] {
  if (!Array.isArray(rows)) throw invalid('Bank accounts must be a list.');
  if (rows.length > MAX_PAYMENT_ACCOUNTS) {
    throw invalid(`At most ${MAX_PAYMENT_ACCOUNTS} bank accounts can be printed on an invoice.`);
  }
  return rows.map((row, i) => {
    const bankName = typeof row?.bankName === 'string' ? row.bankName.trim() : '';
    const accountNumber = typeof row?.accountNumber === 'string' ? row.accountNumber.trim() : '';
    if (!bankName || !accountNumber) {
      throw invalid(`Bank account ${i + 1} needs both a bank name and an account number.`);
    }
    if (bankName.length > BANK_NAME_MAX_LENGTH) {
      throw invalid(`Bank account ${i + 1}: the bank name is limited to ${BANK_NAME_MAX_LENGTH} characters.`);
    }
    if (accountNumber.length > ACCOUNT_NUMBER_MAX_LENGTH) {
      throw invalid(
        `Bank account ${i + 1}: the account number is limited to ${ACCOUNT_NUMBER_MAX_LENGTH} characters.`,
      );
    }
    return { bankName, accountNumber };
  });
}

/** `undefined` keeps the current value; `null` or blank text clears it; text is trimmed. */
function pick(value: string | null | undefined, current: string | null | undefined): string | null {
  if (value === undefined) return current ?? null;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
