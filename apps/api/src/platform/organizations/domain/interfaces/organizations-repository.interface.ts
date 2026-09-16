import type { InvoiceTemplate } from '@erp/types';

import type { OrganizationEntity } from '../entities/organization.entity.js';

export interface IOrganizationsRepository {
  findById(id: string): Promise<OrganizationEntity | null>;
  findBySlug(slug: string): Promise<OrganizationEntity | null>;
  findAll(): Promise<OrganizationEntity[]>;
  create(data: CreateOrganizationData): Promise<OrganizationEntity>;
  updateBranding(id: string, patch: OrganizationBrandingPatch): Promise<OrganizationEntity>;
}

export interface CreateOrganizationData {
  name: string;
  slug: string;
}

/** Every field is a distinct optional — `undefined` leaves it unchanged, `null` clears it. */
export interface OrganizationBrandingPatch {
  logoFileId?: string | null;
  legalAddress?: string | null;
  taxRegistrationNumber?: string | null;
  brandColorHex?: string | null;
  invoiceFooterNote?: string | null;
  invoiceTemplate?: InvoiceTemplate;
}
