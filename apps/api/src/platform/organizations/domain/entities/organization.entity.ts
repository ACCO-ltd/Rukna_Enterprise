import { InvoiceTemplate, OrganizationStatus } from '@erp/types';

export class OrganizationEntity {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly slug: string,
    public readonly status: OrganizationStatus,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    // Invoice branding (Commercial round-3) — all optional, so an org with none of this set
    // still bills, it just gets a plain document. See ClientInvoice.billingAddressSnapshot for
    // why these are never rewritten onto an already-issued invoice.
    public readonly logoFileId: string | null = null,
    public readonly legalAddress: string | null = null,
    public readonly taxRegistrationNumber: string | null = null,
    public readonly brandColorHex: string | null = null,
    public readonly invoiceFooterNote: string | null = null,
    public readonly invoiceTemplate: InvoiceTemplate = InvoiceTemplate.STANDARD,
  ) {}

  isActive(): boolean {
    return this.status === OrganizationStatus.ACTIVE;
  }
}
