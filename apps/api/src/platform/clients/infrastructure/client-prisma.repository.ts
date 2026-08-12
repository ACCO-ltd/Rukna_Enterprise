import { Injectable } from '@nestjs/common';
import { PrismaClient, Client, ClientContact, ClientType } from '@prisma/client';

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
    name: string;
    nameAr?: string;
    type?: ClientType;
    taxNumber?: string;
    defaultCurrency?: string;
    address?: string;
    notes?: string;
    primaryContact?: { name: string; phone?: string; email?: string };
  }): Promise<Client> {
    const { primaryContact, ...clientData } = data;
    return prisma.$transaction(async (tx) => {
      const sequence = await tx.clientCodeSequence.upsert({
        where: { organizationId: data.organizationId },
        create: { organizationId: data.organizationId, nextValue: 2 },
        update: { nextValue: { increment: 1 } },
        select: { nextValue: true },
      });
      const code = `CLI-${String(sequence.nextValue - 1).padStart(6, '0')}`;
      const client = await tx.client.create({ data: { ...clientData, code } });

      if (primaryContact) {
        await tx.clientContact.create({
          data: {
            clientId: client.id,
            name: primaryContact.name,
            phone: primaryContact.phone,
            email: primaryContact.email,
            isPrimary: true,
          },
        });
      }

      return client;
    });
  }

  async update(prisma: PrismaClient, id: string, data: {
    name?: string;
    nameAr?: string;
    type?: ClientType;
    taxNumber?: string;
    defaultCurrency?: string;
    address?: string;
    notes?: string;
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
