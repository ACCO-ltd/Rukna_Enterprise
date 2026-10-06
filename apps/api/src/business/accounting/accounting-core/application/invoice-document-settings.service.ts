import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  InvoiceDocumentPolicyRepository,
  readPaymentAccounts,
  readPhones,
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
export const TAGLINE_MAX_LENGTH = 80;
/** The footer strip has room for two address lines of about 60 characters each. */
export const FOOTER_ADDRESS_MAX_LINES = 2;
export const FOOTER_LINE_MAX_LENGTH = 60;
export const PHONE_MAX_LENGTH = 30;
export const MAX_FOOTER_PHONES = 2;
export const EMAIL_MAX_LENGTH = 80;
export const WEBSITE_MAX_LENGTH = 80;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A host with a dot, optionally with a scheme and a path: "www.acco.com", "https://acco.com/x". */
const WEBSITE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i;
const PHONE = /^\+?[0-9 ()./-]{5,}$/;

export interface InvoiceDocumentSettingsView {
  /** The "Bank Account Details" rows, in print order. */
  paymentAccounts: InvoicePaymentAccount[];
  /** The organisation's own notes (one per line), or null while it uses the defaults. */
  notes: string | null;
  defaultNotes: string[];
  signatoryName: string | null;
  signatoryTitle: string | null;
  tagline: string | null;
  /** Null → invoices print the organisation's legal address in the footer. */
  footerAddress: string | null;
  /** The organisation's legal address, shown as the footer default. */
  defaultFooterAddress: string | null;
  footerPhones: string[];
  footerEmail: string | null;
  footerWebsite: string | null;
  showBankDetails: boolean;
  showNotes: boolean;
  updatedAt: string | null;
}

export interface UpdateInvoiceDocumentSettingsInput {
  paymentAccounts?: Array<{ bankName: string; accountNumber: string }>;
  notes?: string | null;
  signatoryName?: string | null;
  signatoryTitle?: string | null;
  tagline?: string | null;
  footerAddress?: string | null;
  footerPhones?: string[];
  footerEmail?: string | null;
  footerWebsite?: string | null;
  showBankDetails?: boolean;
  showNotes?: boolean;
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
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const [policy, org] = await Promise.all([
      this.repo.find(prisma, orgId),
      prisma.organization.findUnique({ where: { id: orgId }, select: { legalAddress: true } }),
    ]);
    return {
      paymentAccounts: readPaymentAccounts(policy?.paymentAccounts),
      notes: policy?.notes ?? null,
      defaultNotes: DEFAULT_INVOICE_NOTES,
      signatoryName: policy?.signatoryName ?? null,
      signatoryTitle: policy?.signatoryTitle ?? null,
      tagline: policy?.tagline ?? null,
      footerAddress: policy?.footerAddress ?? null,
      defaultFooterAddress: org?.legalAddress?.trim() || null,
      footerPhones: readPhones(policy?.footerPhones),
      footerEmail: policy?.footerEmail ?? null,
      footerWebsite: policy?.footerWebsite ?? null,
      showBankDetails: policy?.showBankDetails ?? false,
      showNotes: policy?.showNotes ?? false,
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
      tagline: pick(input.tagline, before?.tagline),
      footerAddress: pickMultiline(input.footerAddress, before?.footerAddress),
      footerPhones:
        input.footerPhones === undefined ? readPhones(before?.footerPhones) : validatePhones(input.footerPhones),
      footerEmail: pick(input.footerEmail, before?.footerEmail),
      footerWebsite: pick(input.footerWebsite, before?.footerWebsite),
      showBankDetails: input.showBankDetails ?? before?.showBankDetails ?? false,
      showNotes: input.showNotes ?? before?.showNotes ?? false,
    };

    if (next.notes && next.notes.length > INVOICE_NOTES_MAX_LENGTH) {
      throw invalid(`Invoice notes are limited to ${INVOICE_NOTES_MAX_LENGTH} characters.`);
    }
    for (const [field, value, max] of [
      ['Signatory name', next.signatoryName, SIGNATORY_MAX_LENGTH],
      ['Signatory title', next.signatoryTitle, SIGNATORY_MAX_LENGTH],
      ['The tagline', next.tagline, TAGLINE_MAX_LENGTH],
      ['The footer email', next.footerEmail, EMAIL_MAX_LENGTH],
      ['The footer website', next.footerWebsite, WEBSITE_MAX_LENGTH],
    ] as const) {
      if (value && value.length > max) throw invalid(`${field} is limited to ${max} characters.`);
    }
    if (next.footerAddress) {
      const lines = next.footerAddress.split('\n');
      if (lines.length > FOOTER_ADDRESS_MAX_LINES) {
        throw invalid(`The footer address fits ${FOOTER_ADDRESS_MAX_LINES} lines; it has ${lines.length}.`);
      }
      const long = lines.find((line) => line.length > FOOTER_LINE_MAX_LENGTH);
      if (long) {
        throw invalid(
          `Each footer address line fits ${FOOTER_LINE_MAX_LENGTH} characters; "${long.slice(0, 30)}…" has ${long.length}.`,
        );
      }
    }
    if (next.footerEmail && !EMAIL.test(next.footerEmail)) {
      throw invalid(`"${next.footerEmail}" is not an email address.`);
    }
    if (next.footerWebsite && !WEBSITE.test(next.footerWebsite)) {
      throw invalid(`"${next.footerWebsite}" is not a website address (e.g. www.acco.com).`);
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
              tagline: before.tagline,
              footerAddress: before.footerAddress,
              footerPhones: readPhones(before.footerPhones),
              footerEmail: before.footerEmail,
              footerWebsite: before.footerWebsite,
              showBankDetails: before.showBankDetails,
              showNotes: before.showNotes,
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

/** At most two phone numbers, trimmed; blanks dropped. */
export function validatePhones(phones: unknown): string[] {
  if (!Array.isArray(phones)) throw invalid('Phone numbers must be a list.');
  const cleaned = phones.map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean);
  if (cleaned.length > MAX_FOOTER_PHONES) {
    throw invalid(`At most ${MAX_FOOTER_PHONES} phone numbers print in the footer.`);
  }
  for (const phone of cleaned) {
    if (phone.length > PHONE_MAX_LENGTH) {
      throw invalid(`A footer phone number fits ${PHONE_MAX_LENGTH} characters.`);
    }
    if (!PHONE.test(phone)) throw invalid(`"${phone}" is not a phone number.`);
  }
  return cleaned;
}

/** Like {@link pick}, keeping line breaks: each line trimmed, blank lines dropped. */
function pickMultiline(value: string | null | undefined, current: string | null | undefined): string | null {
  if (value === undefined) return current ?? null;
  if (value === null) return null;
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : null;
}

/** `undefined` keeps the current value; `null` or blank text clears it; text is trimmed. */
function pick(value: string | null | undefined, current: string | null | undefined): string | null {
  if (value === undefined) return current ?? null;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
