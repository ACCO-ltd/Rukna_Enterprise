import { BadRequestException, Injectable } from '@nestjs/common';
import { PERMISSIONS, type PermissionKey, type RequestIdentity, type SearchRecord, type SearchResponse } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../project-access/project-access.service.js';
import { SearchRepository } from '../infrastructure/search.repository.js';

const MIN_QUERY = 2;
const MAX_QUERY = 80;
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Step 2f (ADR-047) — record search for the ⌘K menu. Each group runs only for a caller holding the
 * permission its own list endpoint requires, so search never shows a record the caller could not
 * open; projects are further limited to the caller's memberships. Up to five hits per group.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: SearchRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async search(identity: RequestIdentity, rawQuery: string): Promise<SearchResponse> {
    const query = (rawQuery ?? '').trim();
    if (query.length < MIN_QUERY) return { query, records: [] };
    if (query.length > MAX_QUERY) throw new BadRequestException('The search is too long.');

    const prisma = this.tenancy.getClient();
    const org = identity.activeOrganizationId;
    const has = (...any: PermissionKey[]) => any.some((p) => identity.permissions.includes(p));

    const [invoices, bills, payments, receipts, journals, projects, clients, suppliers] = await Promise.all([
      has(PERMISSIONS.receivablesManage) ? this.repo.invoices(prisma, org, query) : [],
      has(PERMISSIONS.payablesManage) ? this.repo.bills(prisma, org, query) : [],
      has(PERMISSIONS.payablesManage) ? this.repo.payments(prisma, org, query) : [],
      has(PERMISSIONS.receivablesManage, PERMISSIONS.receiptsView) ? this.repo.receipts(prisma, org, query) : [],
      has(PERMISSIONS.journalsManage) ? this.repo.journals(prisma, org, query) : [],
      has(PERMISSIONS.projectsView)
        ? this.projectAccess.accessibleProjectIds(identity).then((ids) => this.repo.projects(prisma, org, query, ids))
        : [],
      has(PERMISSIONS.clientsView) ? this.repo.clients(prisma, org, query) : [],
      has(PERMISSIONS.payablesManage, PERMISSIONS.procurementView) ? this.repo.suppliers(prisma, org, query) : [],
    ]);

    const records: SearchRecord[] = [
      ...invoices.map((i) => ({
        kind: 'INVOICE' as const,
        id: i.id,
        title: i.invoiceNumber ?? 'Draft invoice',
        detail: `${i.client.name} · ${day(i.invoiceDate)}`,
        amount: i.totalAmount.toFixed(2),
        currencyCode: i.currencyCode,
        status: i.documentStatus === 'APPROVED' ? i.postingStatus : i.documentStatus,
        clientId: i.clientId,
      })),
      ...receipts.map((r) => ({
        kind: 'RECEIPT' as const,
        id: r.id,
        title: r.receiptNumber ?? r.reference ?? 'Receipt',
        detail: `${r.client.name} · ${day(r.receiptDate)}`,
        amount: r.totalAmount.toFixed(2),
        currencyCode: r.currencyCode,
        status: r.postingStatus,
        clientId: r.clientId,
      })),
      ...bills.map((b) => ({
        kind: 'BILL' as const,
        id: b.id,
        title: b.billNumber ?? b.supplierInvoiceNumber,
        detail: `${b.supplier.name} · ref ${b.supplierInvoiceNumber}`,
        amount: b.totalAmount.toFixed(2),
        currencyCode: b.currencyCode,
        status: b.documentStatus === 'APPROVED' ? b.postingStatus : b.documentStatus,
        clientId: null,
      })),
      ...payments.map((p) => ({
        kind: 'PAYMENT' as const,
        id: p.id,
        title: p.paymentNumber ?? 'Draft payment',
        detail: `${p.supplier.name} · ${day(p.paymentDate)}`,
        amount: p.totalAmount.toFixed(2),
        currencyCode: p.currencyCode,
        status: p.postingStatus,
        clientId: null,
      })),
      ...journals.map((j) => ({
        kind: 'JOURNAL' as const,
        id: j.id,
        title: j.journalNumber ?? 'Draft journal',
        detail: `${j.description} · ${day(j.accountingDate)}`,
        amount: null,
        currencyCode: null,
        status: j.status,
        clientId: null,
      })),
      ...projects.map((p) => ({
        kind: 'PROJECT' as const,
        id: p.id,
        title: p.name,
        detail: p.code,
        amount: null,
        currencyCode: null,
        status: p.status,
        clientId: p.clientId,
      })),
      ...clients.map((c) => ({
        kind: 'CLIENT' as const,
        id: c.id,
        title: c.name,
        detail: c.code,
        amount: null,
        currencyCode: null,
        status: c.status,
        clientId: c.id,
      })),
      ...suppliers.map((s) => ({
        kind: 'SUPPLIER' as const,
        id: s.id,
        title: s.name,
        detail: s.code,
        amount: null,
        currencyCode: null,
        status: s.status,
        clientId: null,
      })),
    ];
    return { query, records };
  }
}
