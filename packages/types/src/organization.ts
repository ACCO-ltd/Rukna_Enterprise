export enum OrganizationStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  createdAt: Date;
  updatedAt: Date;
  // Invoice branding (Commercial round-3) — see InvoiceTemplate in enums.ts.
  logoFileId: string | null;
  legalAddress: string | null;
  taxRegistrationNumber: string | null;
  brandColorHex: string | null;
  invoiceFooterNote: string | null;
  invoiceTemplate: string;
}

/** `PATCH /organizations/:id/branding` body. `undefined` leaves a field unchanged, `null` clears it. */
export interface UpdateOrganizationBrandingInput {
  logoFileId?: string | null;
  legalAddress?: string | null;
  taxRegistrationNumber?: string | null;
  brandColorHex?: string | null;
  invoiceFooterNote?: string | null;
  invoiceTemplate?: string;
}
