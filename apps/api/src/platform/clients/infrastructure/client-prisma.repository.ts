import { Injectable } from '@nestjs/common';
import { PrismaClient, Client, ClientContact, ClientType } from '@prisma/client';

export type ClientWithContacts = Client & { contacts: ClientContact[] };

export interface ClientListItem {
  id: string;
  name: string;
  status: Client['status'];
  primaryContact: Pick<ClientContact, 'name' | 'role'> | null;
  activeProjectCount: number;
  outstandingBalance: string | null;
}

@Injectable()
export class ClientPrismaRepository {
  async findAll(prisma: PrismaClient, organizationId: string): Promise<Client[]> {
    return prisma.client.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  async findListSummary(
    prisma: PrismaClient,
    organizationId: string,
    includeFinancials: boolean,
  ): Promise<ClientListItem[]> {
    const clients = await prisma.client.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        status: true,
        contacts: {
          orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
          take: 1,
          select: { name: true, role: true },
        },
        _count: {
          select: {
            projects: {
              where: { status: { in: ['ACTIVE', 'MOBILIZING', 'PRACTICAL_COMPLETION', 'CLOSEOUT'] } },
            },
          },
        },
      },
    });

    const balances = includeFinancials
      ? await prisma.clientInvoice.groupBy({
          by: ['clientId'],
          where: { organizationId, postingStatus: 'POSTED' },
          _sum: { outstandingAmount: true },
        })
      : [];
    const balanceByClient = new Map(
      balances.map((row) => [row.clientId, row._sum.outstandingAmount?.toFixed(2) ?? '0.00']),
    );

    return clients.map((client) => ({
      id: client.id,
      name: client.name,
      status: client.status,
      primaryContact: client.contacts[0] ?? null,
      activeProjectCount: client._count.projects,
      outstandingBalance: includeFinancials ? (balanceByClient.get(client.id) ?? '0.00') : null,
    }));
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
    primaryContact?: { name: string; role?: string; phone?: string; email?: string };
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
            role: primaryContact.role,
            phone: primaryContact.phone,
            email: primaryContact.email,
            isPrimary: true,
          },
        });
      }

      return client;
    });
  }

  findDuplicateCandidates(prisma: PrismaClient, organizationId: string, name: string) {
    return prisma.client.findMany({
      where: { organizationId, name: { contains: name.trim(), mode: 'insensitive' } },
      select: { id: true, name: true, type: true, status: true },
      orderBy: { name: 'asc' },
      take: 5,
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
    return prisma.$transaction(async (tx) => {
      if (data.isPrimary) await tx.clientContact.updateMany({ where: { clientId }, data: { isPrimary: false } });
      return tx.clientContact.create({ data: { clientId, ...data } });
    });
  }

  async removeContact(prisma: PrismaClient, clientId: string, contactId: string): Promise<boolean> {
    const result = await prisma.clientContact.deleteMany({ where: { id: contactId, clientId } });
    return result.count > 0;
  }
}
