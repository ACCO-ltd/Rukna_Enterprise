import { Injectable, NotFoundException } from '@nestjs/common';
import { Client } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import { ClientPrismaRepository, ClientWithContacts } from '../infrastructure/client-prisma.repository.js';
import type { CreateClientDto } from '../presentation/dto/create-client.dto.js';
import type { UpdateClientDto } from '../presentation/dto/update-client.dto.js';
import type { AddContactDto } from '../presentation/dto/add-contact.dto.js';

@Injectable()
export class ClientService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: ClientPrismaRepository,
  ) {}

  async findAll(identity: RequestIdentity): Promise<Client[]> {
    const prisma = this.tenancyService.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId);
  }

  async findListSummary(identity: RequestIdentity) {
    const prisma = this.tenancyService.getClient();
    const includeFinancials = identity.permissions.includes(PERMISSIONS.financialPositionView);
    return this.repo.findListSummary(prisma, identity.activeOrganizationId, includeFinancials);
  }

  async findDuplicateCandidates(identity: RequestIdentity, name: string) {
    if (name.trim().length < 3) return [];
    const prisma = this.tenancyService.getClient();
    return this.repo.findDuplicateCandidates(prisma, identity.activeOrganizationId, name);
  }

  async findOne(identity: RequestIdentity, id: string): Promise<ClientWithContacts> {
    const prisma = this.tenancyService.getClient();
    const client = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!client) throw new NotFoundException(`Client ${id} not found`);
    return client;
  }

  async create(identity: RequestIdentity, dto: CreateClientDto): Promise<Client> {
    const prisma = this.tenancyService.getClient();
    return this.repo.create(prisma, {
      organizationId: identity.activeOrganizationId,
      name: dto.name,
      nameAr: dto.nameAr,
      type: dto.type,
      taxNumber: dto.taxNumber,
      defaultCurrency: 'USD',
      address: dto.address,
      notes: dto.notes,
      primaryContact: dto.primaryContact,
    });
  }

  async update(identity: RequestIdentity, id: string, dto: UpdateClientDto): Promise<Client> {
    const prisma = this.tenancyService.getClient();
    await this.requireClient(prisma, identity.activeOrganizationId, id);
    return this.repo.update(prisma, id, dto);
  }

  async addContact(identity: RequestIdentity, clientId: string, dto: AddContactDto) {
    const prisma = this.tenancyService.getClient();
    await this.requireClient(prisma, identity.activeOrganizationId, clientId);
    return this.repo.addContact(prisma, clientId, dto);
  }

  async removeContact(identity: RequestIdentity, clientId: string, contactId: string): Promise<void> {
    const prisma = this.tenancyService.getClient();
    await this.requireClient(prisma, identity.activeOrganizationId, clientId);
    const removed = await this.repo.removeContact(prisma, clientId, contactId);
    if (!removed) throw new NotFoundException(`Contact ${contactId} not found on client ${clientId}`);
  }

  private async requireClient(prisma: ReturnType<TenancyService['getClient']>, organizationId: string, id: string) {
    const client = await this.repo.findById(prisma, organizationId, id);
    if (!client) throw new NotFoundException(`Client ${id} not found`);
    return client;
  }
}
