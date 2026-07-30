import type { OrganizationEntity } from '../entities/organization.entity.js';

export interface IOrganizationsRepository {
  findById(id: string): Promise<OrganizationEntity | null>;
  findBySlug(slug: string): Promise<OrganizationEntity | null>;
  findAll(): Promise<OrganizationEntity[]>;
  create(data: CreateOrganizationData): Promise<OrganizationEntity>;
}

export interface CreateOrganizationData {
  name: string;
  slug: string;
}
