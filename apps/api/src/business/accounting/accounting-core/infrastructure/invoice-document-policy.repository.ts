import { Injectable } from '@nestjs/common';
import { Prisma, type InvoiceDocumentPolicy, type PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** One row of the invoice's "Bank Account Details" table, as typed in the invoice settings. */
export interface InvoicePaymentAccount {
  bankName: string;
  accountNumber: string;
}

/**
 * The invoice document settings as an invoice freezes them, stored in
 * `ClientInvoice.billingAddressSnapshot.org.invoiceDocument` when the invoice is raised and again
 * when it is issued — so a later edit never reaches an invoice already raised.
 */
export interface InvoiceDocumentSnapshot {
  paymentAccounts: InvoicePaymentAccount[];
  notes: string | null;
  signatory: { name: string; title: string | null } | null;
  tagline: string | null;
  /** The footer contact strip. A null address falls back to the organisation's legal address. */
  footer: InvoiceFooterContacts;
  /** The optional sections — OFF unless Finance turns them on (and for snapshots older than them). */
  showBankDetails: boolean;
  showNotes: boolean;
}

export interface InvoiceFooterContacts {
  address: string | null;
  phones: string[];
  email: string | null;
  website: string | null;
}

export interface InvoiceDocumentPolicyWrite {
  paymentAccounts: InvoicePaymentAccount[];
  notes: string | null;
  signatoryName: string | null;
  signatoryTitle: string | null;
  tagline: string | null;
  footerAddress: string | null;
  footerPhones: string[];
  footerEmail: string | null;
  footerWebsite: string | null;
  showBankDetails: boolean;
  showNotes: boolean;
}

/** The organisation's invoice document settings (`InvoiceDocumentPolicy`). */
@Injectable()
export class InvoiceDocumentPolicyRepository {
  find(prisma: TenantPrisma, organizationId: string): Promise<InvoiceDocumentPolicy | null> {
    return prisma.invoiceDocumentPolicy.findUnique({ where: { organizationId } });
  }

  upsert(prisma: TenantPrisma, organizationId: string, data: InvoiceDocumentPolicyWrite, updatedBy: string) {
    const row = {
      ...data,
      paymentAccounts: data.paymentAccounts as unknown as Prisma.InputJsonValue,
      footerPhones: data.footerPhones as unknown as Prisma.InputJsonValue,
    };
    return prisma.invoiceDocumentPolicy.upsert({
      where: { organizationId },
      create: { organizationId, ...row, updatedBy },
      update: { ...row, updatedBy },
    });
  }

  async recordAudit(
    tx: TenantPrisma,
    data: { organizationId: string; userId: string; before: object | null; after: object },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        userId: data.userId,
        orgId: data.organizationId,
        action: 'INVOICE_DOCUMENT_SETTINGS_UPDATED',
        resource: 'invoice-document-settings',
        resourceId: data.organizationId,
        before: (data.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: data.after as Prisma.InputJsonValue,
        sourceCommand: 'invoice-document-settings.update',
      },
    });
  }
}

/**
 * The stored `payment_accounts` JSON as rows — tolerant of anything malformed (a non-array, a row
 * missing a field), which is skipped rather than printed half-empty.
 */
export function readPaymentAccounts(value: unknown): InvoicePaymentAccount[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const { bankName, accountNumber } = row as Record<string, unknown>;
    if (typeof bankName !== 'string' || typeof accountNumber !== 'string') return [];
    const bank = bankName.trim();
    const number = accountNumber.trim();
    return bank && number ? [{ bankName: bank, accountNumber: number }] : [];
  });
}

/** Stored phone numbers (JSON) as trimmed, non-empty strings, at most two. */
export function readPhones(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 2);
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const EMPTY_SNAPSHOT: InvoiceDocumentSnapshot = {
  paymentAccounts: [],
  notes: null,
  signatory: null,
  tagline: null,
  footer: { address: null, phones: [], email: null, website: null },
  showBankDetails: false,
  showNotes: false,
};

/** The policy as the values an invoice prints. No policy → defaults (nothing optional shown). */
export function toInvoiceDocumentSnapshot(policy: InvoiceDocumentPolicy | null): InvoiceDocumentSnapshot {
  if (!policy) return EMPTY_SNAPSHOT;
  const name = policy.signatoryName?.trim() || null;
  return {
    paymentAccounts: readPaymentAccounts(policy.paymentAccounts),
    notes: policy.notes?.trim() ? policy.notes : null,
    signatory: name ? { name, title: policy.signatoryTitle?.trim() || null } : null,
    tagline: text(policy.tagline),
    footer: {
      address: policy.footerAddress?.trim() ? policy.footerAddress.trim() : null,
      phones: readPhones(policy.footerPhones),
      email: text(policy.footerEmail),
      website: text(policy.footerWebsite),
    },
    showBankDetails: policy.showBankDetails,
    showNotes: policy.showNotes,
  };
}

/**
 * Read and resolve the settings for an invoice snapshot. A plain function on the tenant client (not
 * a service method) so the invoice snapshot can take it inside the invoice-creating transaction.
 */
export async function resolveInvoiceDocumentSnapshot(
  prisma: TenantPrisma,
  organizationId: string,
): Promise<InvoiceDocumentSnapshot> {
  return toInvoiceDocumentSnapshot(await prisma.invoiceDocumentPolicy.findUnique({ where: { organizationId } }));
}

/**
 * A frozen snapshot in any of its shapes: the current one; the bank-table shape (no tagline,
 * footer or switches — read with those at their defaults, so nothing optional shows); or the
 * single-bank shape of the first template-v2 release (`bank: { … }`), read as a one-row table.
 */
export function normalizeInvoiceDocumentSnapshot(value: unknown): InvoiceDocumentSnapshot {
  const snap = (value ?? {}) as Record<string, unknown>;
  const legacyBank = snap.bank as { bankName?: unknown; accountNumber?: unknown } | null | undefined;
  const paymentAccounts =
    snap.paymentAccounts !== undefined
      ? readPaymentAccounts(snap.paymentAccounts)
      : readPaymentAccounts(legacyBank ? [legacyBank] : []);
  const signatory = snap.signatory as { name?: unknown; title?: unknown } | null | undefined;
  const name = typeof signatory?.name === 'string' ? signatory.name.trim() : '';
  const footer = (snap.footer ?? {}) as Record<string, unknown>;
  return {
    paymentAccounts,
    notes: typeof snap.notes === 'string' && snap.notes.trim() ? snap.notes : null,
    signatory: name
      ? { name, title: typeof signatory?.title === 'string' && signatory.title.trim() ? signatory.title.trim() : null }
      : null,
    tagline: text(snap.tagline),
    footer: {
      address: text(footer.address),
      phones: readPhones(footer.phones),
      email: text(footer.email),
      website: text(footer.website),
    },
    showBankDetails: snap.showBankDetails === true,
    showNotes: snap.showNotes === true,
  };
}
