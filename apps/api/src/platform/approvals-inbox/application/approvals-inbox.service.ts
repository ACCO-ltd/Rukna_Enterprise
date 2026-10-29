import { Injectable } from '@nestjs/common';
import { PERMISSIONS, type ApprovalInbox, type ApprovalItem, type PermissionKey, type RequestIdentity } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../project-access/project-access.service.js';
import { SegregationOfDutiesService } from '../../workflows/application/segregation-of-duties.service.js';
import { ApprovalsInboxRepository } from '../infrastructure/approvals-inbox.repository.js';

// ADR-022 CONST-DOA-001 — the consolidated System Administrator role decides no business transaction.
const SYSTEM_ADMINISTRATOR_ROLE = 'SYSTEM_ADMINISTRATOR';
const iso = (d: Date) => d.toISOString();
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Step 3 (ADR-049) — the one Approvals inbox: everything waiting on the caller's decision.
 *
 * A queue runs only for a caller holding the permission its own Approve / Decide endpoint
 * requires; project documents are limited to the caller's projects; and an item a segregation-of-
 * duties rule would stop the caller deciding (their own journal, request or quote, goods they
 * received, a bill they approved) is left out — the inbox never offers a decision the server would
 * refuse. Oldest first: what has waited longest is at the top.
 */
@Injectable()
export class ApprovalsInboxService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ApprovalsInboxRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly sod: SegregationOfDutiesService,
  ) {}

  async inbox(identity: RequestIdentity): Promise<ApprovalInbox> {
    const prisma = this.tenancy.getClient();
    const org = identity.activeOrganizationId;
    const me = identity.userId;
    const has = (p: PermissionKey) => identity.permissions.includes(p);

    const [codes, projects] = await Promise.all([
      this.sod.activeRuleCodes(org),
      this.projectAccess.accessibleProjectIds(identity),
    ]);
    const barred = (context: Omit<Parameters<SegregationOfDutiesService['violation']>[1], 'organizationId' | 'actorUserId'>) =>
      this.sod.violation(codes, { organizationId: org, actorUserId: me, ...context }) !== null;

    const [invoices, writeOffs, journals, bills, payments, quotations, requests, reports, steps] = await Promise.all([
      has(PERMISSIONS.receivablesManage) ? this.repo.invoicesAwaitingApproval(prisma, org, projects) : [],
      has(PERMISSIONS.receivablesManage) ? this.repo.writeOffsAwaitingApproval(prisma, org) : [],
      has(PERMISSIONS.journalsManage) ? this.repo.submittedJournals(prisma, org) : [],
      has(PERMISSIONS.payablesManage) ? this.repo.submittedBills(prisma, org, projects) : [],
      has(PERMISSIONS.payablesManage) ? this.repo.draftPayments(prisma, org) : [],
      has(PERMISSIONS.quotationsAward) ? this.repo.quotationsAwaitingDecision(prisma, org, projects) : [],
      has(PERMISSIONS.materialRequestsApprove) ? this.repo.submittedMaterialRequests(prisma, org, projects) : [],
      has(PERMISSIONS.progressApprove) ? this.repo.submittedProgressReports(prisma, org, projects) : [],
      this.repo.pendingWorkflowSteps(prisma, org, identity.roles),
    ]);
    const receivers = await this.repo.goodsReceivers(
      prisma,
      org,
      bills.flatMap((b) => (b.purchaseOrderId ? [b.purchaseOrderId] : [])),
    );

    type Draft = Omit<ApprovalItem, 'requestedByName' | 'projectName'> & { requestedBy: string | null };
    const drafts: Draft[] = [];
    const base = { projectId: null, transactionType: null };

    // Invoices above the approval amount (ADR-046 §8): a second person approves, never the preparer.
    for (const inv of invoices) {
      if (inv.createdBy === me) continue;
      drafts.push({
        ...base,
        kind: 'INVOICE',
        id: inv.id,
        title: inv.client.name,
        detail: `Draft of ${day(inv.invoiceDate)}`,
        amount: inv.totalAmount.toFixed(2),
        currencyCode: inv.currencyCode,
        waitingSince: iso(inv.createdAt),
        requestedBy: inv.createdBy,
        projectId: inv.projectId,
      });
    }

    // AR-4 — write-offs above the limit: a second person decides, never the one who asked.
    for (const w of writeOffs) {
      if (w.requestedBy === me) continue;
      drafts.push({
        ...base,
        kind: 'WRITE_OFF',
        id: w.id,
        parentId: w.invoiceId,
        title: w.invoice.client.name,
        detail: `${w.invoice.invoiceNumber ?? 'Opening balance'} · ${w.reason === 'BAD_DEBT' ? 'Bad debt' : 'Small balance'}`,
        amount: w.amount.toFixed(2),
        currencyCode: w.invoice.currencyCode,
        waitingSince: iso(w.requestedAt),
        requestedBy: w.requestedBy,
        projectId: w.invoice.projectId,
      });
    }

    // Journals: the preparer may decide their own only with post-own:journal (ADR-046 §1).
    for (const j of journals) {
      const own = j.createdBy === me;
      if (own && !has(PERMISSIONS.journalsPostOwn) && barred({ action: 'APPROVE_MANUAL_JOURNAL', journalPreparerUserId: j.createdBy })) continue;
      const debit = j.lines.reduce((sum, l) => sum + Number(l.debitAmount), 0);
      drafts.push({
        ...base,
        kind: 'JOURNAL',
        id: j.id,
        // A journal is numbered when it posts; until then its accounting date names it.
        title: j.journalNumber ?? `Dated ${day(j.accountingDate)}`,
        detail: j.description,
        amount: debit.toFixed(2),
        currencyCode: j.currencyCode,
        waitingSince: iso(j.submittedAt ?? j.createdAt),
        requestedBy: j.submittedBy ?? j.createdBy,
      });
    }

    for (const b of bills) {
      const received = b.purchaseOrderId ? receivers.get(b.purchaseOrderId)?.has(me) : false;
      if (received && barred({ action: 'APPROVE_SUPPLIER_BILL', goodsReceiverUserId: me })) continue;
      drafts.push({
        ...base,
        kind: 'BILL',
        id: b.id,
        title: b.billNumber ?? b.supplierInvoiceNumber,
        detail: `${b.supplier.name} · ref ${b.supplierInvoiceNumber}`,
        amount: b.totalAmount.toFixed(2),
        currencyCode: b.currencyCode,
        waitingSince: iso(b.updatedAt),
        requestedBy: b.createdBy,
        projectId: b.projectId,
      });
    }

    for (const p of payments) {
      const approvedABill = p.allocations.some((a) => a.bill.approvedBy === me);
      if (approvedABill && barred({ action: 'APPROVE_OR_RELEASE_SUPPLIER_PAYMENT', supplierBillApproverUserId: me })) continue;
      drafts.push({
        ...base,
        kind: 'PAYMENT',
        id: p.id,
        title: p.paymentNumber ?? `Dated ${day(p.paymentDate)}`,
        detail: `${p.supplier.name} · ${day(p.paymentDate)}`,
        amount: p.totalAmount.toFixed(2),
        currencyCode: p.currencyCode,
        waitingSince: iso(p.createdAt),
        requestedBy: p.createdBy,
      });
    }

    for (const q of quotations) {
      const touchers = [q.createdBy, ...q.quotes.flatMap((x) => [x.uploadedBy, x.withdrawnBy ?? '', ...x.photos.map((ph) => ph.uploadedBy)])];
      if (barred({ action: 'SELECT_QUOTATION', requesterUserId: q.materialRequest.requestedBy, quoteUploaderUserIds: touchers.filter(Boolean) })) continue;
      drafts.push({
        ...base,
        kind: 'QUOTATION',
        id: q.id,
        title: q.number,
        detail: q.materialRequest.title ? `${q.materialRequest.mrNumber} · ${q.materialRequest.title}` : q.materialRequest.mrNumber,
        amount: null,
        currencyCode: null,
        waitingSince: iso(q.updatedAt),
        requestedBy: q.createdBy,
        projectId: q.projectId,
      });
    }

    for (const r of requests) {
      if (barred({ action: 'APPROVE_MATERIAL_REQUEST', requesterUserId: r.requestedBy })) continue;
      drafts.push({
        ...base,
        kind: 'MATERIAL_REQUEST',
        id: r.id,
        title: r.mrNumber,
        detail: r.title,
        amount: null,
        currencyCode: null,
        waitingSince: iso(r.updatedAt),
        requestedBy: r.requestedBy,
        projectId: r.projectId,
      });
    }

    for (const d of reports) {
      drafts.push({
        ...base,
        kind: 'PROGRESS_REPORT',
        id: d.id,
        title: day(d.reportDate),
        detail: null,
        amount: null,
        currencyCode: null,
        waitingSince: iso(d.submittedAt ?? d.createdAt),
        requestedBy: d.submittedBy ?? d.preparedBy,
        projectId: d.projectId,
      });
    }

    // Governed approvals (ADR-011) — the step now current needs one of the caller's roles. A
    // document already listed from its own queue is not listed twice.
    const listed = new Set(drafts.map((d) => d.id));
    const isSysAdmin = identity.roles.includes(SYSTEM_ADMINISTRATOR_ROLE);
    for (const s of steps) {
      const current = s.definition.steps.find((step) => step.stepOrder === s.currentStepOrder);
      if (!current || !identity.roles.includes(current.roleRequired)) continue;
      if (s.initiatedBy === me || listed.has(s.transactionId)) continue;
      if (barred({ action: 'APPROVE_BUSINESS_TRANSACTION', isSystemAdministrator: isSysAdmin })) continue;
      drafts.push({
        ...base,
        kind: 'WORKFLOW',
        id: s.transactionId,
        title: s.definition.name,
        detail: current.roleRequired,
        amount: s.evaluatedAmount ? s.evaluatedAmount.toFixed(2) : null,
        currencyCode: s.evaluatedAmount ? 'USD' : null,
        waitingSince: iso(s.updatedAt),
        requestedBy: s.initiatedBy,
        transactionType: s.transactionType,
      });
    }

    const [users, projectRows] = await Promise.all([
      this.repo.userNames(prisma, [...new Set(drafts.flatMap((d) => (d.requestedBy ? [d.requestedBy] : [])))]),
      this.repo.projectNames(prisma, org, [...new Set(drafts.flatMap((d) => (d.projectId ? [d.projectId] : [])))]),
    ]);
    const userName = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
    const projectName = new Map(projectRows.map((p) => [p.id, p.name]));

    const items: ApprovalItem[] = drafts
      .map(({ requestedBy, ...d }) => ({
        ...d,
        requestedByName: requestedBy ? (userName.get(requestedBy) ?? null) : null,
        projectName: d.projectId ? (projectName.get(d.projectId) ?? null) : null,
      }))
      .sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));
    return { items, count: items.length };
  }
}
