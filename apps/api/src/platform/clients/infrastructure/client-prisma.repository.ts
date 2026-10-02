import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, Client, ClientContact, ClientStatus, ClientType } from '@prisma/client';

import {
  ACTIVE_PROJECT_STATUSES,
  FINISHED_PROJECT_STATUSES,
  LIVE_CONTRACT_STATUSES,
  SIGNED_CONTRACT_STATUSES,
  utcMidnight,
} from '../domain/client-rules.js';

/** A tenant client or an open transaction — every read/write here works on either. */
export type Db = Prisma.TransactionClient | PrismaClient;

export type ClientWithContacts = Client & { contacts: ClientContact[] };

/** Primary first, then oldest first (id breaks ties for rows created in the same instant). */
const CONTACT_ORDER: Prisma.ClientContactOrderByWithRelationInput[] = [
  { isPrimary: 'desc' },
  { createdAt: 'asc' },
  { id: 'asc' },
];

export interface ClientMasterData {
  name: string;
  type?: ClientType;
  taxNumber?: string | null;
  registrationNumber?: string | null;
  paymentTermsDays?: number | null;
  countryCode?: string;
  city?: string | null;
  address?: string | null;
  invoiceEmail?: string | null;
  notes?: string | null;
  defaultCurrency?: string | null;
}

export interface ContactData {
  name: string;
  role: string | null;
  phone: string;
  whatsappPhone: string | null;
  email: string | null;
}

export interface ClientListFilter {
  search?: string;
  status?: ClientStatus;
  type?: ClientType;
}

export interface ClientBalance {
  outstanding: Prisma.Decimal;
  overdue: Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);

/**
 * "Open balance" reads ClientInvoice directly (the clients module is platform and must not import
 * the AR/commercial services). Σ `outstandingAmount` of POSTED client invoices — the rule Commercial
 * uses (business/construction/commercial/infrastructure/commercial-prisma.repository.ts) — plus
 * OPENING_BALANCE invoices migrated from the prior system: they are real receivables, and the
 * reconciliation counts them too (accounting-core/application/reconciliation.service.ts). Unapplied
 * receipts are NOT netted. "Overdue" = the same, restricted to invoices whose due date is
 * before today (UTC) — the D5 overdue rule (`daysPastDue > 0`, commercial-workspace.policy.ts).
 */
function postedOpenInvoices(organizationId: string): Prisma.ClientInvoiceWhereInput {
  return { organizationId, postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] }, outstandingAmount: { gt: 0 } };
}

@Injectable()
export class ClientPrismaRepository {
  async findAll(prisma: Db, organizationId: string): Promise<Client[]> {
    return prisma.client.findMany({ where: { organizationId }, orderBy: { name: 'asc' } });
  }

  async findById(prisma: Db, organizationId: string, id: string): Promise<ClientWithContacts | null> {
    return prisma.client.findFirst({
      where: { id, organizationId },
      include: { contacts: { orderBy: CONTACT_ORDER } },
    });
  }

  /**
   * Row-lock the client for the rest of the transaction. Every contact write and status change
   * takes this lock first, so two concurrent "first contact" adds or make-primary calls serialise
   * instead of racing the one-primary partial unique index.
   */
  async lockClient(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
  ): Promise<{ id: string; status: ClientStatus } | null> {
    const rows = await tx.$queryRaw<Array<{ id: string; status: ClientStatus }>>`
      SELECT id, status FROM clients WHERE id = ${id} AND organization_id = ${organizationId} FOR UPDATE`;
    return rows[0] ?? null;
  }

  findDuplicateCandidates(prisma: Db, organizationId: string, name: string) {
    return prisma.client.findMany({
      where: { organizationId, name: { contains: name.trim(), mode: 'insensitive' } },
      select: { id: true, name: true, type: true, status: true },
      orderBy: { name: 'asc' },
      take: 5,
    });
  }

  // ─── Writes ────────────────────────────────────────────────────────────────

  async createClient(
    tx: Prisma.TransactionClient,
    organizationId: string,
    data: ClientMasterData,
  ): Promise<Client> {
    const sequence = await tx.clientCodeSequence.upsert({
      where: { organizationId },
      create: { organizationId, nextValue: 2 },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });
    const code = `CLI-${String(sequence.nextValue - 1).padStart(6, '0')}`;
    return tx.client.create({ data: { ...data, organizationId, code } });
  }

  updateClient(tx: Prisma.TransactionClient, id: string, data: Partial<ClientMasterData>): Promise<Client> {
    return tx.client.update({ where: { id }, data });
  }

  setStatus(tx: Prisma.TransactionClient, id: string, status: ClientStatus): Promise<Client> {
    return tx.client.update({ where: { id }, data: { status } });
  }

  findContacts(tx: Db, clientId: string): Promise<ClientContact[]> {
    return tx.clientContact.findMany({ where: { clientId }, orderBy: CONTACT_ORDER });
  }

  createContact(
    tx: Prisma.TransactionClient,
    clientId: string,
    data: ContactData & { isPrimary: boolean },
  ): Promise<ClientContact> {
    return tx.clientContact.create({ data: { clientId, ...data } });
  }

  updateContact(
    tx: Prisma.TransactionClient,
    contactId: string,
    data: Partial<ContactData>,
  ): Promise<ClientContact> {
    return tx.clientContact.update({ where: { id: contactId }, data });
  }

  /** Demote first, then promote — the partial unique index allows one primary at any instant. */
  async makePrimary(tx: Prisma.TransactionClient, clientId: string, contactId: string): Promise<ClientContact> {
    await tx.clientContact.updateMany({
      where: { clientId, isPrimary: true, NOT: { id: contactId } },
      data: { isPrimary: false },
    });
    return tx.clientContact.update({ where: { id: contactId }, data: { isPrimary: true } });
  }

  async demotePrimary(tx: Prisma.TransactionClient, clientId: string): Promise<void> {
    await tx.clientContact.updateMany({ where: { clientId, isPrimary: true }, data: { isPrimary: false } });
  }

  async deleteContact(tx: Prisma.TransactionClient, contactId: string): Promise<void> {
    await tx.clientContact.delete({ where: { id: contactId } });
  }

  // ─── Rules facts ───────────────────────────────────────────────────────────

  /** What decides whether a client may be deactivated (see domain/client-rules.ts). */
  async deactivationFacts(
    prisma: Db,
    organizationId: string,
    clientId: string,
  ): Promise<{ unfinishedProjectCount: number; openBalance: Prisma.Decimal }> {
    const [unfinishedProjectCount, balance] = await Promise.all([
      prisma.project.count({
        where: { organizationId, clientId, status: { notIn: [...FINISHED_PROJECT_STATUSES] } },
      }),
      prisma.clientInvoice.aggregate({
        where: { ...postedOpenInvoices(organizationId), clientId },
        _sum: { outstandingAmount: true },
      }),
    ]);
    return { unfinishedProjectCount, openBalance: balance._sum.outstandingAmount ?? ZERO };
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  private listWhere(organizationId: string, filter: ClientListFilter): Prisma.ClientWhereInput {
    const where: Prisma.ClientWhereInput = { organizationId };
    if (filter.status) where.status = filter.status;
    if (filter.type) where.type = filter.type;
    const search = filter.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { contacts: { some: { name: { contains: search, mode: 'insensitive' } } } },
      ];
    }
    return where;
  }

  /** Ids of every client matching the filters, in name order (id breaks ties). */
  async listMatchingIds(
    prisma: Db,
    organizationId: string,
    filter: ClientListFilter,
    direction: 'asc' | 'desc',
  ): Promise<string[]> {
    const rows = await prisma.client.findMany({
      where: this.listWhere(organizationId, filter),
      orderBy: [{ name: direction }, { id: 'asc' }],
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Outstanding and overdue per client (only clients that owe something appear). */
  async balancesByClient(prisma: Db, organizationId: string, asOf: Date): Promise<Map<string, ClientBalance>> {
    const today = new Date(utcMidnight(asOf));
    const [owed, late] = await Promise.all([
      prisma.clientInvoice.groupBy({
        by: ['clientId'],
        where: postedOpenInvoices(organizationId),
        _sum: { outstandingAmount: true },
      }),
      prisma.clientInvoice.groupBy({
        by: ['clientId'],
        where: { ...postedOpenInvoices(organizationId), dueDate: { lt: today } },
        _sum: { outstandingAmount: true },
      }),
    ]);
    const lateBy = new Map(late.map((r) => [r.clientId, r._sum.outstandingAmount ?? ZERO]));
    return new Map(
      owed.map((r) => [
        r.clientId,
        { outstanding: r._sum.outstandingAmount ?? ZERO, overdue: lateBy.get(r.clientId) ?? ZERO },
      ]),
    );
  }

  /** The display rows for one page of ids (returned in the order of `ids`). */
  async listRows(prisma: Db, organizationId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await prisma.client.findMany({
      where: { organizationId, id: { in: ids } },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        status: true,
        contacts: { where: { isPrimary: true }, take: 1, select: { name: true, phone: true } },
        _count: { select: { projects: true } },
      },
    });
    const active = await prisma.project.groupBy({
      by: ['clientId'],
      where: { organizationId, clientId: { in: ids }, status: { in: [...ACTIVE_PROJECT_STATUSES] } },
      _count: { _all: true },
    });
    const activeBy = new Map(active.map((r) => [r.clientId, r._count._all]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined)
      .map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        type: r.type,
        status: r.status,
        primaryContact: r.contacts[0] ?? null,
        totalProjectCount: r._count.projects,
        activeProjectCount: activeBy.get(r.id) ?? 0,
      }));
  }

  // ─── Overview ──────────────────────────────────────────────────────────────

  findClientProjects(prisma: Db, organizationId: string, clientId: string) {
    return prisma.project.findMany({
      where: { organizationId, clientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: { id: true, code: true, name: true, status: true },
    });
  }

  /**
   * Contract value per project: Σ `contractValue` (the CURRENT value, base + adopted variations —
   * ADR-029 CONST-BOQ-032) of the client's signed contracts on it.
   */
  async contractValueByProject(
    prisma: Db,
    organizationId: string,
    clientId: string,
  ): Promise<Map<string, Prisma.Decimal>> {
    const rows = await prisma.contract.groupBy({
      by: ['projectId'],
      where: { organizationId, clientId, status: { in: [...SIGNED_CONTRACT_STATUSES] } },
      _sum: { contractValue: true },
    });
    return new Map(rows.map((r) => [r.projectId, r._sum.contractValue ?? ZERO]));
  }

  async activeContractValue(prisma: Db, organizationId: string, clientId: string): Promise<Prisma.Decimal> {
    const result = await prisma.contract.aggregate({
      where: { organizationId, clientId, status: { in: [...LIVE_CONTRACT_STATUSES] } },
      _sum: { contractValue: true },
    });
    return result._sum.contractValue ?? ZERO;
  }

  /** POSTED invoices that still carry a balance — oldest due first, undated last. */
  findUnpaidInvoices(prisma: Db, organizationId: string, clientId: string) {
    return prisma.clientInvoice.findMany({
      where: { ...postedOpenInvoices(organizationId), clientId },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { invoiceDate: 'asc' }, { id: 'asc' }],
      select: { id: true, invoiceNumber: true, projectId: true, dueDate: true, outstandingAmount: true },
    });
  }

  findProjectNames(prisma: Db, organizationId: string, ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return prisma.project.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true },
    });
  }

  /**
   * Unapplied cash on the client's posted receipts. Mirrors `sumClientUnappliedReceipts` in
   * business/construction/commercial/infrastructure/commercial-prisma.repository.ts.
   */
  async unappliedCredit(prisma: Db, organizationId: string, clientId: string): Promise<Prisma.Decimal> {
    const result = await prisma.paymentReceipt.aggregate({
      where: { organizationId, clientId, postingStatus: 'POSTED' },
      _sum: { unallocatedAmount: true },
    });
    return result._sum.unallocatedAmount ?? ZERO;
  }

  // ─── Activity ──────────────────────────────────────────────────────────────

  findClientAuditRows(prisma: Db, organizationId: string, clientId: string, resource: string, take: number) {
    return prisma.auditLog.findMany({
      where: { orgId: organizationId, resource, resourceId: clientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true,
        userId: true,
        sourceCommand: true,
        before: true,
        after: true,
        reason: true,
        createdAt: true,
      },
    });
  }

  findPostedInvoices(prisma: Db, organizationId: string, clientId: string, take: number) {
    return prisma.clientInvoice.findMany({
      where: { organizationId, clientId, postedAt: { not: null } },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take,
      select: { id: true, invoiceNumber: true, totalAmount: true, currencyCode: true, postedAt: true, postedBy: true },
    });
  }

  findPostedReceipts(prisma: Db, organizationId: string, clientId: string, take: number) {
    return prisma.paymentReceipt.findMany({
      where: { organizationId, clientId, postedAt: { not: null } },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take,
      select: { id: true, receiptNumber: true, totalAmount: true, currencyCode: true, postedAt: true, postedBy: true },
    });
  }
}
