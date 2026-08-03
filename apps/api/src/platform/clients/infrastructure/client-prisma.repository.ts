import { Injectable } from '@nestjs/common';
import { PrismaClient, Client, ClientContact } from '@prisma/client';

export type ClientWithContacts = Client & { contacts: ClientContact[] };

@Injectable()
export class ClientPrismaRepository {
  async findAll(prisma: PrismaClient, organizationId: string): Promise<Client[]> {
    return prisma.client.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  async findById(prisma: PrismaClient, organizationId: string, id: string): Promise<ClientWithContacts | null> {
    return prisma.client.findFirst({
      where: { id, organizationId },
      include: { contacts: true },
    });
  }

  async findByCode(prisma: PrismaClient, organizationId: string, code: string): Promise<Client | null> {
    return prisma.client.findFirst({ where: { organizationId, code } });
  }

  async create(prisma: PrismaClient, data: {
    organizationId: string;
    code: string;
    name: string;
    nameAr?: string;
    taxNumber?: string;
    defaultCurrency?: string;
  }): Promise<Client> {
    return prisma.client.create({ data });
  }

  async update(prisma: PrismaClient, id: string, data: {
    name?: string;
    nameAr?: string;
    taxNumber?: string;
    defaultCurrency?: string;
    status?: 'ACTIVE' | 'INACTIVE';
  }): Promise<Client> {
    return prisma.client.update({ where: { id }, data });
  }

  async addContact(prisma: PrismaClient, clientId: string, data: {
    name: string;
    role?: string;
    email?: string;
    phone?: string;
    isPrimary?: boolean;
  }): Promise<ClientContact> {
    if (data.isPrimary) {
      await prisma.clientContact.updateMany({
        where: { clientId },
        data: { isPrimary: false },
      });
    }
    return prisma.clientContact.create({ data: { clientId, ...data } });
  }

  async removeContact(prisma: PrismaClient, contactId: string): Promise<void> {
    await prisma.clientContact.delete({ where: { id: contactId } });
  }
}
