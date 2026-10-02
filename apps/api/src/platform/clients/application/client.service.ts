import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client, ClientContact, Prisma } from '@prisma/client';
import {
  PERMISSIONS,
  type ClientActivityEntry,
  type ClientContactView,
  type ClientDetailResponse,
  type ClientListItemView,
  type ClientListResponse,
  type ClientOverviewResponse,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../audit-logs/application/transactional-audit-outbox.service.js';
import { loadActorNames } from '../../users/application/actor-names.js';
import {
  ClientPrismaRepository,
  type ClientMasterData,
  type ClientWithContacts,
  type ContactData,
  type Db,
} from '../infrastructure/client-prisma.repository.js';
import {
  invalid,
  normaliseCountryCode,
  normaliseEmail,
  normaliseName,
  normaliseOptionalText,
  normalisePaymentTermsDays,
  normalisePhone,
  patchValue,
} from '../domain/client-input.js';
import {
  ACTIVE_PROJECT_STATUSES,
  CLIENT_AUDIT,
  CLIENT_AUDIT_RESOURCE,
  allowedClientCommands,
  clientAuditSummary,
  collectionStatus,
  daysPastDue,
  deactivationBlocker,
} from '../domain/client-rules.js';
import type { CreateClientDto, ClientFieldsDto } from '../presentation/dto/create-client.dto.js';
import type { UpdateClientDto } from '../presentation/dto/update-client.dto.js';
import type { AddContactDto } from '../presentation/dto/add-contact.dto.js';
import type { UpdateContactDto } from '../presentation/dto/update-contact.dto.js';
import type { ContactInputDto } from '../presentation/dto/contact-input.dto.js';
import {
  CLIENT_LIST_DEFAULT_PAGE_SIZE,
  CLIENT_LIST_MAX_PAGE_SIZE,
  type ClientListQueryDto,
} from '../presentation/dto/client-list-query.dto.js';

type AuditStep = (typeof CLIENT_AUDIT)[keyof typeof CLIENT_AUDIT];

const money = (d: Prisma.Decimal): string => d.toFixed(2);
const isoDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** The editable master-data fields, in the order an audit lists them. */
const CLIENT_FIELDS = [
  'name',
  'type',
  'taxNumber',
  'registrationNumber',
  'paymentTermsDays',
  'countryCode',
  'city',
  'address',
  'invoiceEmail',
  'notes',
  'defaultCurrency',
] as const;
type ClientField = (typeof CLIENT_FIELDS)[number];

const CONTACT_FIELDS = ['name', 'role', 'phone', 'whatsappPhone', 'email'] as const;
type ContactField = (typeof CONTACT_FIELDS)[number];

function normaliseCurrency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value.trim())) {
    throw invalid('FIELD_INVALID', 'defaultCurrency', 'Currency must be a three-letter code');
  }
  return value.trim().toUpperCase();
}

/**
 * Client master data, contacts, status and the record's read models (clients redesign,
 * docs/design/clients-redesign-contract.md). Every write is one transaction that row-locks the
 * client and records its audit row (`resource: 'client'`) in the same transaction.
 */
@Injectable()
export class ClientService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: ClientPrismaRepository,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  // ─── Reads ─────────────────────────────────────────────────────────────────

  async findAll(identity: RequestIdentity): Promise<Client[]> {
    return this.repo.findAll(this.db(), identity.activeOrganizationId);
  }

  async findDuplicateCandidates(identity: RequestIdentity, name: string) {
    if (name.trim().length < 3) return [];
    return this.repo.findDuplicateCandidates(this.db(), identity.activeOrganizationId, name);
  }

  async findOne(identity: RequestIdentity, id: string): Promise<ClientDetailResponse> {
    const prisma = this.db();
    const client = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!client) throw new NotFoundException(`Client ${id} not found`);
    return this.toDetail(prisma, identity, client);
  }

  async findList(identity: RequestIdentity, query: ClientListQueryDto): Promise<ClientListResponse> {
    const prisma = this.db();
    const orgId = identity.activeOrganizationId;
    const moneyVisible = this.moneyVisible(identity);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? CLIENT_LIST_DEFAULT_PAGE_SIZE, CLIENT_LIST_MAX_PAGE_SIZE);
    // Money-dependent filters and sorts are ignored without the money permission — never a 403,
    // never a leak through ordering.
    const sort = !moneyVisible && (query.sort === 'outstanding' || query.sort === '-outstanding') ? 'name' : (query.sort ?? 'name');
    const balanceFilter = moneyVisible ? query.balance : undefined;

    let ids = await this.repo.listMatchingIds(
      prisma,
      orgId,
      { search: query.search, status: query.status, type: query.type },
      sort === '-name' ? 'desc' : 'asc',
    );
    const balances = moneyVisible ? await this.repo.balancesByClient(prisma, orgId, new Date()) : new Map();
    const zero = new Prisma.Decimal(0);
    const outstandingOf = (id: string): Prisma.Decimal => balances.get(id)?.outstanding ?? zero;
    const overdueOf = (id: string): Prisma.Decimal => balances.get(id)?.overdue ?? zero;

    if (balanceFilter === 'OWES') ids = ids.filter((id) => outstandingOf(id).gt(0));
    if (balanceFilter === 'OVERDUE') ids = ids.filter((id) => overdueOf(id).gt(0));
    if (sort === 'outstanding' || sort === '-outstanding') {
      const sign = sort === 'outstanding' ? 1 : -1;
      // Array.prototype.sort is stable, so equal balances keep the name order.
      ids = [...ids].sort((a, b) => sign * outstandingOf(a).comparedTo(outstandingOf(b)));
    }

    const total = ids.length;
    const pageIds = ids.slice((page - 1) * pageSize, page * pageSize);
    const rows = await this.repo.listRows(prisma, orgId, pageIds);
    const items: ClientListItemView[] = rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      status: r.status,
      primaryContact: r.primaryContact ? { name: r.primaryContact.name, phone: r.primaryContact.phone ?? null } : null,
      activeProjectCount: r.activeProjectCount,
      totalProjectCount: r.totalProjectCount,
      outstanding: moneyVisible ? money(outstandingOf(r.id)) : null,
      overdue: moneyVisible ? money(overdueOf(r.id)) : null,
    }));
    return { items, total, page, pageSize, moneyVisible };
  }

  async findOverview(identity: RequestIdentity, id: string): Promise<ClientOverviewResponse> {
    const prisma = this.db();
    const orgId = identity.activeOrganizationId;
    await this.requireClient(prisma, orgId, id);
    const moneyVisible = this.moneyVisible(identity);
    const projects = await this.repo.findClientProjects(prisma, orgId, id);

    if (!moneyVisible) {
      return {
        moneyVisible,
        metrics: null,
        projects: projects.map((p) => ({ ...p, contractValue: null, outstanding: null })),
        unpaidInvoices: null,
      };
    }

    const asOf = new Date();
    const [valueByProject, unpaid, activeContractValue, unappliedCredit] = await Promise.all([
      this.repo.contractValueByProject(prisma, orgId, id),
      this.repo.findUnpaidInvoices(prisma, orgId, id),
      this.repo.activeContractValue(prisma, orgId, id),
      this.repo.unappliedCredit(prisma, orgId, id),
    ]);

    const zero = new Prisma.Decimal(0);
    const outstandingByProject = new Map<string, Prisma.Decimal>();
    let outstanding = zero;
    let overdue = zero;
    let oldestOverdue: (typeof unpaid)[number] | null = null;
    for (const inv of unpaid) {
      outstanding = outstanding.plus(inv.outstandingAmount);
      if (inv.projectId) {
        outstandingByProject.set(inv.projectId, (outstandingByProject.get(inv.projectId) ?? zero).plus(inv.outstandingAmount));
      }
      if (inv.dueDate && daysPastDue(inv.dueDate, asOf) > 0) {
        overdue = overdue.plus(inv.outstandingAmount);
        // `unpaid` is ordered by due date ascending, so the first overdue one is the oldest.
        oldestOverdue ??= inv;
      }
    }

    const names = new Map(projects.map((p) => [p.id, p.name]));
    const missing = [...new Set(unpaid.map((i) => i.projectId).filter((p): p is string => !!p && !names.has(p)))];
    for (const p of await this.repo.findProjectNames(prisma, orgId, missing)) names.set(p.id, p.name);

    const activeProjectCount = projects.filter((p) =>
      (ACTIVE_PROJECT_STATUSES as readonly string[]).includes(p.status),
    ).length;

    return {
      moneyVisible,
      // An invoice need not belong to a project (projectId is nullable — opening balances, one-offs),
      // so a client with no projects can still owe money: the strip shows whenever there is either.
      metrics:
        projects.length === 0 && unpaid.length === 0
          ? null
          : {
              activeProjectCount,
              totalProjectCount: projects.length,
              activeContractValue: money(activeContractValue),
              outstanding: money(outstanding),
              unpaidInvoiceCount: unpaid.length,
              overdue: money(overdue),
              overdueDays: oldestOverdue?.dueDate ? daysPastDue(oldestOverdue.dueDate, asOf) : null,
              oldestOverdueInvoice: oldestOverdue
                ? { id: oldestOverdue.id, invoiceNumber: oldestOverdue.invoiceNumber }
                : null,
              unappliedCredit: money(unappliedCredit),
            },
      projects: projects.map((p) => ({
        ...p,
        contractValue: valueByProject.has(p.id) ? money(valueByProject.get(p.id)!) : null,
        outstanding: money(outstandingByProject.get(p.id) ?? zero),
      })),
      unpaidInvoices: unpaid.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        projectId: inv.projectId,
        projectName: inv.projectId ? (names.get(inv.projectId) ?? null) : null,
        dueDate: isoDate(inv.dueDate),
        balance: money(inv.outstandingAmount),
        collectionStatus: collectionStatus(inv.dueDate, asOf),
      })),
    };
  }

  async findActivity(identity: RequestIdentity, id: string, limit = 10): Promise<ClientActivityEntry[]> {
    const prisma = this.db();
    const orgId = identity.activeOrganizationId;
    await this.requireClient(prisma, orgId, id);
    const moneyVisible = this.moneyVisible(identity);

    const [auditRows, invoices, receipts] = await Promise.all([
      this.repo.findClientAuditRows(prisma, orgId, id, CLIENT_AUDIT_RESOURCE, limit),
      moneyVisible ? this.repo.findPostedInvoices(prisma, orgId, id, limit) : Promise.resolve([]),
      moneyVisible ? this.repo.findPostedReceipts(prisma, orgId, id, limit) : Promise.resolve([]),
    ]);
    const actorName = await loadActorNames(prisma, [
      ...auditRows.map((r) => r.userId),
      ...invoices.map((i) => i.postedBy ?? ''),
      ...receipts.map((r) => r.postedBy ?? ''),
    ]);
    const asRecord = (v: Prisma.JsonValue | null): Record<string, unknown> | null =>
      v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    const amount = (currency: string, value: Prisma.Decimal) =>
      `${currency} ${Number(value.toFixed(2)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const entries: Array<ClientActivityEntry & { sortAt: number }> = [
      ...auditRows.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        sortAt: r.createdAt.getTime(),
        actorName: actorName(r.userId),
        action: r.sourceCommand ?? 'client.update',
        summary: clientAuditSummary(r.sourceCommand ?? '', asRecord(r.before), asRecord(r.after), r.reason),
      })),
      ...invoices.map((i) => ({
        id: `invoice-${i.id}`,
        at: i.postedAt!.toISOString(),
        sortAt: i.postedAt!.getTime(),
        actorName: actorName(i.postedBy ?? ''),
        action: 'invoice.posted',
        summary: `Invoice ${i.invoiceNumber ?? '(unnumbered)'} issued — ${amount(i.currencyCode, i.totalAmount)}`,
      })),
      ...receipts.map((r) => ({
        id: `receipt-${r.id}`,
        at: r.postedAt!.toISOString(),
        sortAt: r.postedAt!.getTime(),
        actorName: actorName(r.postedBy ?? ''),
        action: 'receipt.posted',
        summary: `Payment${r.receiptNumber ? ` ${r.receiptNumber}` : ''} received — ${amount(r.currencyCode, r.totalAmount)}`,
      })),
    ];
    return entries
      .sort((a, b) => b.sortAt - a.sortAt)
      .slice(0, limit)
      .map(({ sortAt: _sortAt, ...entry }) => entry);
  }

  // ─── Client writes ─────────────────────────────────────────────────────────

  async create(identity: RequestIdentity, dto: CreateClientDto): Promise<ClientDetailResponse> {
    const orgId = identity.activeOrganizationId;
    const data: ClientMasterData = {
      ...this.clientPatch(dto, 'create'),
      name: normaliseName(dto.name, 'name'),
      // Unchanged from before the redesign: new clients bill in USD.
      defaultCurrency: 'USD',
    };
    if (!dto.primaryContact) throw invalid('CONTACT_REQUIRED', 'primaryContact', 'A primary contact is required');
    const contact = this.contactData(dto.primaryContact, 'primaryContact.');

    const prisma = this.db();
    const client = await prisma.$transaction(async (tx) => {
      const created = await this.repo.createClient(tx, orgId, data);
      const primary = await this.repo.createContact(tx, created.id, { ...contact, isPrimary: true });
      await this.audit(tx, identity, created.id, CLIENT_AUDIT.create, {
        after: { ...this.pick(created, CLIENT_FIELDS), code: created.code, primaryContact: primary.name },
      });
      return created;
    });
    return this.findOne(identity, client.id);
  }

  async update(identity: RequestIdentity, id: string, dto: UpdateClientDto): Promise<ClientDetailResponse> {
    const orgId = identity.activeOrganizationId;
    const patch = this.clientPatch(dto, 'update');
    if (dto.name !== undefined) patch.name = normaliseName(dto.name, 'name');
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException({ errorCode: 'NO_CHANGES', message: 'At least one field must be provided' });
    }

    const prisma = this.db();
    await prisma.$transaction(async (tx) => {
      if (!(await this.repo.lockClient(tx, orgId, id))) throw new NotFoundException(`Client ${id} not found`);
      const existing = (await this.repo.findById(tx, orgId, id))!;
      const { before, after } = this.diff(existing, patch);
      if (Object.keys(after).length === 0) return;
      await this.repo.updateClient(tx, id, after as Partial<ClientMasterData>);
      await this.audit(tx, identity, id, CLIENT_AUDIT.update, { before, after });
    });
    return this.findOne(identity, id);
  }

  async deactivate(identity: RequestIdentity, id: string, reasonInput: string): Promise<ClientDetailResponse> {
    const reason = typeof reasonInput === 'string' ? reasonInput.trim().replace(/\s+/g, ' ') : '';
    if (reason.length < 3 || reason.length > 500) {
      throw invalid('REASON_INVALID', 'reason', 'Reason must be 3–500 characters');
    }
    const orgId = identity.activeOrganizationId;
    const prisma = this.db();
    await prisma.$transaction(async (tx) => {
      const locked = await this.repo.lockClient(tx, orgId, id);
      if (!locked) throw new NotFoundException(`Client ${id} not found`);
      if (locked.status === 'INACTIVE') {
        throw new ConflictException({ errorCode: 'CLIENT_ALREADY_INACTIVE', message: 'The client is already inactive' });
      }
      const facts = await this.repo.deactivationFacts(tx, orgId, id);
      const blocker = deactivationBlocker({
        unfinishedProjectCount: facts.unfinishedProjectCount,
        hasOpenBalance: facts.openBalance.gt(0),
      });
      if (blocker === 'ACTIVE_PROJECTS') {
        throw new ConflictException({
          errorCode: 'CLIENT_HAS_ACTIVE_PROJECTS',
          message: 'Close or cancel this client’s projects before deactivating it',
        });
      }
      if (blocker === 'OPEN_BALANCE') {
        throw new ConflictException({
          errorCode: 'CLIENT_HAS_OPEN_BALANCE',
          message: 'This client still owes money on posted invoices',
        });
      }
      await this.repo.setStatus(tx, id, 'INACTIVE');
      await this.audit(tx, identity, id, CLIENT_AUDIT.deactivate, {
        before: { status: 'ACTIVE' },
        after: { status: 'INACTIVE' },
        reason,
      });
    });
    return this.findOne(identity, id);
  }

  async reactivate(identity: RequestIdentity, id: string): Promise<ClientDetailResponse> {
    const orgId = identity.activeOrganizationId;
    const prisma = this.db();
    await prisma.$transaction(async (tx) => {
      const locked = await this.repo.lockClient(tx, orgId, id);
      if (!locked) throw new NotFoundException(`Client ${id} not found`);
      if (locked.status === 'ACTIVE') {
        throw new ConflictException({ errorCode: 'CLIENT_ALREADY_ACTIVE', message: 'The client is already active' });
      }
      await this.repo.setStatus(tx, id, 'ACTIVE');
      await this.audit(tx, identity, id, CLIENT_AUDIT.reactivate, {
        before: { status: 'INACTIVE' },
        after: { status: 'ACTIVE' },
      });
    });
    return this.findOne(identity, id);
  }

  // ─── Contact writes ────────────────────────────────────────────────────────

  async addContact(identity: RequestIdentity, clientId: string, dto: AddContactDto): Promise<ClientContactView> {
    const contact = this.contactData(dto, '');
    const orgId = identity.activeOrganizationId;
    const prisma = this.db();
    const created = await prisma.$transaction(async (tx) => {
      await this.lockOrThrow(tx, orgId, clientId);
      const existing = await this.repo.findContacts(tx, clientId);
      // The first contact is always primary; `isPrimary: true` demotes the current one.
      const isPrimary = existing.length === 0 || dto.isPrimary === true;
      if (isPrimary) await this.repo.demotePrimary(tx, clientId);
      const row = await this.repo.createContact(tx, clientId, { ...contact, isPrimary });
      await this.audit(tx, identity, clientId, CLIENT_AUDIT.contactAdd, {
        after: { contactId: row.id, name: row.name, role: row.role, isPrimary },
      });
      return row;
    });
    return this.toContactView(created);
  }

  async updateContact(
    identity: RequestIdentity,
    clientId: string,
    contactId: string,
    dto: UpdateContactDto,
  ): Promise<ClientContactView> {
    const patch: Partial<Record<ContactField, string | null>> = {};
    if (dto.name !== undefined) patch.name = normaliseName(dto.name, 'name');
    if (dto.role !== undefined) patch.role = normaliseOptionalText(dto.role, 'role', 100);
    if (dto.phone !== undefined) {
      if (dto.phone === null) throw invalid('PHONE_INVALID', 'phone', 'A contact needs a phone number');
      patch.phone = normalisePhone(dto.phone, 'phone');
    }
    if (dto.whatsappPhone !== undefined) patch.whatsappPhone = patchValue(dto.whatsappPhone, (v) => normalisePhone(v, 'whatsappPhone'));
    if (dto.email !== undefined) patch.email = patchValue(dto.email, (v) => normaliseEmail(v, 'email'));
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException({ errorCode: 'NO_CHANGES', message: 'At least one field must be provided' });
    }

    const orgId = identity.activeOrganizationId;
    const prisma = this.db();
    return prisma.$transaction(async (tx) => {
      await this.lockOrThrow(tx, orgId, clientId);
      const current = await this.contactOrThrow(tx, clientId, contactId);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of Object.keys(patch) as ContactField[]) {
        if ((current[key] ?? null) !== (patch[key] ?? null)) {
          before[key] = current[key] ?? null;
          after[key] = patch[key] ?? null;
        }
      }
      if (Object.keys(after).length === 0) return this.toContactView(current);
      const updated = await this.repo.updateContact(tx, contactId, after as Partial<ContactData>);
      await this.audit(tx, identity, clientId, CLIENT_AUDIT.contactUpdate, {
        before: { ...before, contactId, contactName: current.name },
        after: { ...after, contactId, contactName: updated.name },
      });
      return this.toContactView(updated);
    });
  }

  async makePrimary(identity: RequestIdentity, clientId: string, contactId: string): Promise<ClientContactView> {
    const orgId = identity.activeOrganizationId;
    const prisma = this.db();
    return prisma.$transaction(async (tx) => {
      await this.lockOrThrow(tx, orgId, clientId);
      const contact = await this.contactOrThrow(tx, clientId, contactId);
      if (contact.isPrimary) return this.toContactView(contact);
      const previous = (await this.repo.findContacts(tx, clientId)).find((c) => c.isPrimary) ?? null;
      const updated = await this.repo.makePrimary(tx, clientId, contactId);
      await this.audit(tx, identity, clientId, CLIENT_AUDIT.contactMakePrimary, {
        before: previous ? { contactId: previous.id, contactName: previous.name } : {},
        after: { contactId, contactName: updated.name },
      });
      return this.toContactView(updated);
    });
  }

  async removeContact(identity: RequestIdentity, clientId: string, contactId: string): Promise<void> {
    const orgId = identity.activeOrganizationId;
    const prisma = this.db();
    await prisma.$transaction(async (tx) => {
      await this.lockOrThrow(tx, orgId, clientId);
      const contact = await this.contactOrThrow(tx, clientId, contactId);
      if (contact.isPrimary) {
        throw new ConflictException({
          errorCode: 'CONTACT_IS_PRIMARY',
          message: 'Make another contact primary before removing this one',
        });
      }
      await this.repo.deleteContact(tx, contactId);
      await this.audit(tx, identity, clientId, CLIENT_AUDIT.contactRemove, {
        before: { contactId, name: contact.name, role: contact.role },
      });
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private db(): PrismaClientLike {
    return this.tenancyService.getClient();
  }

  private moneyVisible(identity: RequestIdentity): boolean {
    return identity.permissions.includes(PERMISSIONS.financialPositionView);
  }

  private async requireClient(prisma: Db, orgId: string, id: string) {
    const client = await this.repo.findById(prisma, orgId, id);
    if (!client) throw new NotFoundException(`Client ${id} not found`);
    return client;
  }

  private async lockOrThrow(tx: Prisma.TransactionClient, orgId: string, clientId: string) {
    const locked = await this.repo.lockClient(tx, orgId, clientId);
    if (!locked) throw new NotFoundException(`Client ${clientId} not found`);
    return locked;
  }

  private async contactOrThrow(tx: Prisma.TransactionClient, clientId: string, contactId: string) {
    const contact = (await this.repo.findContacts(tx, clientId)).find((c) => c.id === contactId);
    if (!contact) throw new NotFoundException(`Contact ${contactId} not found on client ${clientId}`);
    return contact;
  }

  /** Normalises the master-data fields present on the DTO (`null` clears an optional field). */
  private clientPatch(dto: ClientFieldsDto, mode: 'create' | 'update'): Partial<ClientMasterData> & { name?: string } {
    const patch: Partial<ClientMasterData> & { name?: string } = {};
    if (dto.type !== undefined && dto.type !== null) patch.type = dto.type;
    const optional = {
      taxNumber: patchValue(dto.taxNumber, (v) => normaliseOptionalText(v, 'taxNumber', 50)),
      registrationNumber: patchValue(dto.registrationNumber, (v) => normaliseOptionalText(v, 'registrationNumber', 50)),
      paymentTermsDays: patchValue(dto.paymentTermsDays, (v) => normalisePaymentTermsDays(v)),
      city: patchValue(dto.city, (v) => normaliseOptionalText(v, 'city', 100)),
      address: patchValue(dto.address, (v) => normaliseOptionalText(v, 'address', 500)),
      invoiceEmail: patchValue(dto.invoiceEmail, (v) => normaliseEmail(v, 'invoiceEmail')),
      notes: patchValue(dto.notes, (v) => normaliseOptionalText(v, 'notes', 2000)),
    };
    for (const [key, value] of Object.entries(optional)) {
      if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
    }
    if (dto.countryCode !== undefined) patch.countryCode = normaliseCountryCode(dto.countryCode);
    if (mode === 'update' && dto.defaultCurrency !== undefined) patch.defaultCurrency = normaliseCurrency(dto.defaultCurrency);
    return patch;
  }

  private contactData(dto: ContactInputDto, prefix: string): ContactData {
    return {
      name: normaliseName(dto.name, `${prefix}name`),
      role: normaliseOptionalText(dto.role, `${prefix}role`, 100),
      phone: normalisePhone(dto.phone, `${prefix}phone`),
      whatsappPhone:
        dto.whatsappPhone === undefined || dto.whatsappPhone === null || dto.whatsappPhone === ''
          ? null
          : normalisePhone(dto.whatsappPhone, `${prefix}whatsappPhone`),
      email:
        dto.email === undefined || dto.email === null || dto.email.trim() === ''
          ? null
          : normaliseEmail(dto.email, `${prefix}email`),
    };
  }

  /** Only the fields that actually change, as before/after maps for the audit row. */
  private diff(existing: Client, patch: Partial<ClientMasterData>) {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of CLIENT_FIELDS) {
      if (!(key in patch)) continue;
      const next = (patch as Record<ClientField, unknown>)[key] ?? null;
      const prev = existing[key] ?? null;
      if (prev !== next) {
        before[key] = prev;
        after[key] = next;
      }
    }
    return { before, after };
  }

  private pick(client: Client, keys: readonly ClientField[]): Record<string, unknown> {
    return Object.fromEntries(keys.map((k) => [k, client[k] ?? null]));
  }

  private async audit(
    tx: Prisma.TransactionClient,
    identity: RequestIdentity,
    clientId: string,
    step: AuditStep,
    payload: { before?: Record<string, unknown>; after?: Record<string, unknown>; reason?: string },
  ): Promise<void> {
    await this.auditOutbox.record(tx, {
      organizationId: identity.activeOrganizationId,
      actorUserId: identity.userId,
      action: step.action,
      resourceType: CLIENT_AUDIT_RESOURCE,
      resourceId: clientId,
      sourceCommand: step.sourceCommand,
      eventType: step.eventType,
      idempotencyKey: `${step.sourceCommand}:${clientId}:${randomUUID()}`,
      ...payload,
    });
  }

  private async toDetail(prisma: Db, identity: RequestIdentity, client: ClientWithContacts): Promise<ClientDetailResponse> {
    let blocker: ClientDetailResponse['deactivationBlockedBy'] = null;
    if (client.status === 'ACTIVE') {
      const facts = await this.repo.deactivationFacts(prisma, identity.activeOrganizationId, client.id);
      blocker = deactivationBlocker({
        unfinishedProjectCount: facts.unfinishedProjectCount,
        hasOpenBalance: facts.openBalance.gt(0),
      });
    }
    return {
      id: client.id,
      organizationId: client.organizationId,
      code: client.code,
      name: client.name,
      type: client.type,
      status: client.status,
      taxNumber: client.taxNumber,
      registrationNumber: client.registrationNumber,
      paymentTermsDays: client.paymentTermsDays,
      defaultCurrency: client.defaultCurrency,
      countryCode: client.countryCode,
      city: client.city,
      address: client.address,
      invoiceEmail: client.invoiceEmail,
      notes: client.notes,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
      contacts: client.contacts.map((c) => this.toContactView(c)),
      allowedCommands: allowedClientCommands(client.status, identity.permissions, blocker),
      deactivationBlockedBy: blocker,
    };
  }

  private toContactView(c: ClientContact): ClientContactView {
    return {
      id: c.id,
      clientId: c.clientId,
      name: c.name,
      role: c.role,
      phone: c.phone,
      whatsappPhone: c.whatsappPhone,
      email: c.email,
      isPrimary: c.isPrimary,
      createdAt: c.createdAt.toISOString(),
    };
  }
}

type PrismaClientLike = ReturnType<TenancyService['getClient']>;
