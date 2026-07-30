import { Injectable } from '@nestjs/common';

import { OrganizationStatus } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import type {
  IOrganizationsRepository,
  CreateOrganizationData,
} from '../domain/interfaces/organizations-repository.interface.js';
import { OrganizationEntity } from '../domain/entities/organization.entity.js';

@Injectable()
export class OrganizationsPrismaRepository implements IOrganizationsRepository {
  constructor(private readonly tenancyService: TenancyService) {}

  async findById(id: string): Promise<OrganizationEntity | null> {
    const prisma = this.tenancyService.getClient();
    const org = await prisma.organization.findUnique({ where: { id } });
    return org ? this.toDomain(org) : null;
  }

  async findBySlug(slug: string): Promise<OrganizationEntity | null> {
    const prisma = this.tenancyService.getClient();
    const org = await prisma.organization.findUnique({ where: { slug } });
    return org ? this.toDomain(org) : null;
  }

  async findAll(): Promise<OrganizationEntity[]> {
    const prisma = this.tenancyService.getClient();
    const orgs = await prisma.organization.findMany();
    return orgs.map((o) => this.toDomain(o));
  }

  async create(data: CreateOrganizationData): Promise<OrganizationEntity> {
    const prisma = this.tenancyService.getClient();
    const org = await prisma.organization.create({ data });
    return this.toDomain(org);
  }

  private toDomain(raw: {
    id: string;
    name: string;
    slug: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): OrganizationEntity {
    return new OrganizationEntity(
      raw.id,
      raw.name,
      raw.slug,
      raw.status as OrganizationStatus,
      raw.createdAt,
      raw.updatedAt,
    );
  }
}
