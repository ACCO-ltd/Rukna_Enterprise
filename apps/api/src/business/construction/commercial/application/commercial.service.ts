import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  type CommercialAdvanceSummary,
  type CommercialApplicationRow,
  type CommercialApplicationsResponse,
  type CommercialAttentionItem,
  type CommercialCapabilities,
  type CommercialGuaranteeSummary,
  type CommercialMetric,
  type CommercialNextAction,
  type CommercialSettlementState,
  type CommercialSummaryResponse,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { CommercialTermPolicy } from '../../contracts/domain/commercial-term-policy.js';
import { deriveGuaranteeAttention } from '../../contracts/domain/guarantee-attention-policy.js';
import { CommercialPrismaRepository } from '../infrastructure/commercial-prisma.repository.js';

const ZERO = new Decimal(0);

type MainContract = NonNullable<
  Awaited<ReturnType<CommercialPrismaRepository['findMainContract']>>
>;
type InvoiceRow = Awaited<ReturnType<CommercialPrismaRepository['findInvoices']>>[number];

@Injectable()
export class CommercialService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly repo: CommercialPrismaRepository,
  ) {}

  // ─── B2 — Project commercial summary ───────────────────────────────────────────

  async getSummary(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<CommercialSummaryResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const mayViewFinancials = identity.permissions.includes(PERMISSIONS.financialPositionView);
    const asOf = new Date();
    const asOfIso = asOf.toISOString();

    const contract = await this.repo.findMainContract(prisma, orgId, projectId);

    if (!contract) {
      // Distinguish "no contract" from "zero" — contract-derived metrics are UNAVAILABLE.
      const unavailable = (): CommercialMetric => ({
        state: 'UNAVAILABLE',
        amount: null,
        currency: null,
        sourceCount: 0,
        drillTo: null,
        asOf: asOfIso,
      });
      return {
        projectId,
        currency: null,
        financialsVisible: mayViewFinancials,
        mainContract: null,
        metrics: {
          contractValue: unavailable(),
          certifiedGross: unavailable(),
          certifiedNet: unavailable(),
          invoiced: unavailable(),
          received: unavailable(),
          outstanding: unavailable(),
        },
        retention: null,
        advances: [],
        guarantees: [],
        attention: [
          {
            id: 'no-main-contract',
            severity: 'WARNING',
            kind: 'NO_MAIN_CONTRACT',
            actionUrl: identity.permissions.includes(PERMISSIONS.contractsCreate)
              ? `/contracts/new?projectId=${projectId}`
              : null,
            responsibleRole: 'CONTRACT_ADMINISTRATOR',
            contextId: null,
          },
        ],
        capabilities: this.capabilities(identity, null),
        recentActivity: [],
        asOf: asOfIso,
      };
    }

    const currency = contract.currency;
    const drill = {
      contract: `/projects/${projectId}/commercial/main-contract`,
      applications: `/projects/${projectId}/commercial/applications`,
    };

    // Independent query groups — a failure in one does not zero out the others (partial
    // failure is represented explicitly as FAILED, never as a silent 0).
    const [certResult, invoiceResult] = await Promise.allSettled([
      this.repo.findEffectiveCertificates(prisma, orgId, contract.id),
      this.repo.findInvoices(prisma, orgId, contract.id),
    ]);

    const certFailed = certResult.status === 'rejected';
    const invoiceFailed = invoiceResult.status === 'rejected';
    const certs = certResult.status === 'fulfilled' ? certResult.value : [];
    const invoices = invoiceResult.status === 'fulfilled' ? invoiceResult.value : [];

    // Certified — effective IPCs only (CONST-COM-003).
    let certifiedGross = ZERO;
    let certifiedDeductions = ZERO;
    for (const cert of certs) {
      certifiedGross = certifiedGross.plus(new Decimal(cert.certifiedTotal.toString()));
      for (const ded of cert.deductions) {
        certifiedDeductions = certifiedDeductions.plus(new Decimal(ded.amount.toString()));
      }
    }
    const certifiedNet = certifiedGross.minus(certifiedDeductions);

    // Settlement — posted AR only (CONST-COM-004).
    const settlement = this.summariseSettlement(invoices);

    const metric = (opts: {
      failed: boolean;
      amount: Decimal;
      sourceCount: number;
      drillTo: string | null;
    }): CommercialMetric => {
      if (!mayViewFinancials) {
        return { state: 'RESTRICTED', amount: null, currency: null, sourceCount: 0, drillTo: null, asOf: asOfIso };
      }
      if (opts.failed) {
        return { state: 'FAILED', amount: null, currency, sourceCount: 0, drillTo: opts.drillTo, asOf: asOfIso };
      }
      return {
        state: opts.sourceCount === 0 ? 'ZERO' : 'OK',
        amount: opts.amount.toFixed(2),
        currency,
        sourceCount: opts.sourceCount,
        drillTo: opts.drillTo,
        asOf: asOfIso,
      };
    };

    const guarantees = contract.guarantees.map((g) =>
      this.toGuaranteeSummary(g, asOf),
    );

    const attention = this.buildAttention(
      projectId,
      certs,
      invoices,
      guarantees,
      { certFailed, invoiceFailed },
      identity,
    );

    // Recent commercial activity spans the contract and its audited children.
    const resourceIds = [
      contract.id,
      ...contract.guarantees.map((g) => g.id),
      ...contract.advanceTerms.map((a) => a.id),
      ...contract.milestones.map((m) => m.id),
      ...certs.map((c) => c.id),
    ];
    const activity = await this.repo
      .findRecentActivity(prisma, orgId, resourceIds)
      .catch(() => []);

    return {
      projectId,
      currency,
      financialsVisible: mayViewFinancials,
      mainContract: {
        id: contract.id,
        contractNumber: contract.contractNumber,
        status: contract.status,
        clientName: contract.clientNameSnapshot ?? contract.client.name,
        startDate: contract.startDate?.toISOString() ?? null,
        expectedEndDate: contract.expectedEndDate?.toISOString() ?? null,
      },
      metrics: {
        contractValue: metric({
          failed: false,
          amount: new Decimal(contract.contractValue.toString()),
          sourceCount: 1,
          drillTo: drill.contract,
        }),
        certifiedGross: metric({
          failed: certFailed,
          amount: certifiedGross,
          sourceCount: certs.length,
          drillTo: drill.applications,
        }),
        certifiedNet: metric({
          failed: certFailed,
          amount: certifiedNet,
          sourceCount: certs.length,
          drillTo: drill.applications,
        }),
        invoiced: metric({
          failed: invoiceFailed,
          amount: settlement.invoiced,
          sourceCount: settlement.postedInvoiceCount,
          drillTo: drill.applications,
        }),
        received: metric({
          failed: invoiceFailed,
          amount: settlement.received,
          sourceCount: settlement.allocationCount,
          drillTo: drill.applications,
        }),
        outstanding: metric({
          failed: invoiceFailed,
          amount: settlement.outstanding,
          sourceCount: settlement.postedInvoiceCount,
          drillTo: drill.applications,
        }),
      },
      retention: contract.retentionTerms
        ? {
            retentionRate: contract.retentionTerms.retentionRate.toString(),
            retentionCap: contract.retentionTerms.retentionCap.toString(),
            retentionSplitOnPC: contract.retentionTerms.retentionSplitOnPC.toString(),
          }
        : null,
      advances: contract.advanceTerms.map(
        (a): CommercialAdvanceSummary => ({
          id: a.id,
          advanceType: a.advanceType,
          description: a.description ?? null,
          amount: a.amount?.toString() ?? null,
          percentage: a.percentage?.toString() ?? null,
          recoveryRate: a.recoveryRate.toString(),
        }),
      ),
      guarantees,
      attention,
      capabilities: this.capabilities(identity, contract),
      recentActivity: activity.map((e) => ({
        id: e.id,
        action: e.action,
        sourceCommand: e.sourceCommand,
        occurredAt: e.createdAt.toISOString(),
        actor: { id: e.user.id, name: `${e.user.firstName} ${e.user.lastName}`.trim() },
      })),
      asOf: asOfIso,
    };
  }

  // ─── B3 — Applications & certificates chain ─────────────────────────────────────

  async getApplications(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<CommercialApplicationsResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const mayViewFinancials = identity.permissions.includes(PERMISSIONS.financialPositionView);
    const asOfIso = new Date().toISOString();

    const contract = await this.repo.findMainContract(prisma, orgId, projectId);
    if (!contract) {
      return {
        projectId,
        contractId: null,
        financialsVisible: mayViewFinancials,
        applications: [],
        capabilities: this.capabilities(identity, null),
        asOf: asOfIso,
      };
    }

    const [applications, invoices] = await Promise.all([
      this.repo.findApplicationsWithCertificates(prisma, orgId, contract.id),
      this.repo.findInvoices(prisma, orgId, contract.id),
    ]);
    const invoiceByIpc = new Map<string, InvoiceRow>();
    for (const inv of invoices) {
      if (inv.sourceIpcId) invoiceByIpc.set(inv.sourceIpcId, inv);
    }

    const money = (d: Decimal): string | null => (mayViewFinancials ? d.toFixed(2) : null);

    const rows = applications.map((ipa): CommercialApplicationRow => {
      const effectiveCert = ipa.certificates.find((c) => c.isEffective) ?? null;
      const supersededCount = ipa.certificates.filter(
        (c) => !c.isEffective && c.status !== 'REJECTED',
      ).length;

      const claimed = ipa.items.reduce(
        (sum, i) => sum.plus(new Decimal(i.periodAmount.toString())),
        ZERO,
      );

      let certGross = ZERO;
      let certDed = ZERO;
      if (effectiveCert) {
        certGross = new Decimal(effectiveCert.certifiedTotal.toString());
        for (const d of effectiveCert.deductions) certDed = certDed.plus(new Decimal(d.amount.toString()));
      }
      const certNet = certGross.minus(certDed);

      const invoice = effectiveCert ? (invoiceByIpc.get(effectiveCert.id) ?? null) : null;
      const invoicePosted = invoice?.postingStatus === 'POSTED';
      const invoiced = invoicePosted ? new Decimal(invoice!.totalAmount.toString()) : ZERO;
      const received = invoice
        ? invoice.allocations.reduce(
            (sum, a) => sum.plus(new Decimal(a.allocatedAmount.toString())),
            ZERO,
          )
        : ZERO;
      const outstanding = invoiced.minus(received);

      const settlementState = this.settlementState(invoicePosted, invoiced, received);

      return {
        ipaId: ipa.id,
        applicationNumber: ipa.applicationNumber ?? null,
        applicationRef: ipa.applicationRef ?? null,
        ipaStatus: ipa.status,
        periodFrom: ipa.periodFrom?.toISOString() ?? null,
        periodTo: ipa.periodTo?.toISOString() ?? null,
        claimedAmount: money(claimed),
        ipcId: effectiveCert?.id ?? null,
        ipcStatus: effectiveCert?.status ?? null,
        certifiedGross: effectiveCert ? money(certGross) : null,
        deductions: effectiveCert ? money(certDed) : null,
        certifiedNet: effectiveCert ? money(certNet) : null,
        supersededCertificateCount: supersededCount,
        invoiceId: invoice?.id ?? null,
        invoiceNumber: invoice?.invoiceNumber ?? null,
        invoiceDocumentStatus: invoice?.documentStatus ?? null,
        invoicePostingStatus: invoice?.postingStatus ?? null,
        invoicedAmount: invoicePosted ? money(invoiced) : null,
        receivedAmount: invoice ? money(received) : null,
        outstandingAmount: invoicePosted ? money(outstanding) : null,
        settlement: settlementState,
        nextAction: this.nextAction(ipa.status, effectiveCert !== null, invoice, invoicePosted, outstanding),
      };
    });

    return {
      projectId,
      contractId: contract.id,
      financialsVisible: mayViewFinancials,
      applications: rows,
      capabilities: this.capabilities(identity, contract),
      asOf: asOfIso,
    };
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────────

  private summariseSettlement(invoices: InvoiceRow[]) {
    let invoiced = ZERO;
    let received = ZERO;
    let postedInvoiceCount = 0;
    let allocationCount = 0;
    for (const inv of invoices) {
      if (inv.postingStatus !== 'POSTED') continue;
      postedInvoiceCount += 1;
      invoiced = invoiced.plus(new Decimal(inv.totalAmount.toString()));
      for (const alloc of inv.allocations) {
        received = received.plus(new Decimal(alloc.allocatedAmount.toString()));
        allocationCount += 1;
      }
    }
    return { invoiced, received, outstanding: invoiced.minus(received), postedInvoiceCount, allocationCount };
  }

  private settlementState(
    invoicePosted: boolean,
    invoiced: Decimal,
    received: Decimal,
  ): CommercialSettlementState {
    if (!invoicePosted) return 'UNINVOICED';
    if (received.lte(ZERO)) return 'UNPAID';
    if (received.gte(invoiced)) return 'PAID';
    return 'PARTIALLY_PAID';
  }

  private nextAction(
    ipaStatus: string,
    hasEffectiveCert: boolean,
    invoice: InvoiceRow | null,
    invoicePosted: boolean,
    outstanding: Decimal,
  ): CommercialNextAction {
    if (ipaStatus === 'DRAFT' || ipaStatus === 'RETURNED_FOR_REVISION') return 'SUBMIT_APPLICATION';
    if (ipaStatus === 'PENDING_INTERNAL_APPROVAL' || ipaStatus === 'APPROVED_FOR_SUBMISSION') {
      return 'REVIEW_APPLICATION';
    }
    if (ipaStatus === 'SUBMITTED' && !hasEffectiveCert) return 'ISSUE_CERTIFICATE';
    if (hasEffectiveCert && !invoice) return 'GENERATE_INVOICE';
    if (invoice && !invoicePosted) return 'POST_INVOICE';
    if (invoicePosted && outstanding.gt(ZERO)) return 'RECORD_RECEIPT';
    return 'NONE';
  }

  private toGuaranteeSummary(
    g: MainContract['guarantees'][number],
    now: Date,
  ): CommercialGuaranteeSummary {
    return {
      id: g.id,
      guaranteeType: g.guaranteeType,
      reference: null,
      issuer: g.issuer,
      beneficiary: g.beneficiary,
      amount: g.amount.toString(),
      currency: g.currency,
      issueDate: g.issueDate.toISOString(),
      expiryDate: g.expiryDate.toISOString(),
      status: g.status,
      attention: deriveGuaranteeAttention(g.expiryDate, g.status, now),
    };
  }

  private buildAttention(
    projectId: string,
    certs: Array<{ id: string }>,
    invoices: InvoiceRow[],
    guarantees: CommercialGuaranteeSummary[],
    failures: { certFailed: boolean; invoiceFailed: boolean },
    identity: RequestIdentity,
  ): CommercialAttentionItem[] {
    const items: CommercialAttentionItem[] = [];
    const drill = `/projects/${projectId}/commercial/applications`;

    if (failures.certFailed || failures.invoiceFailed) {
      items.push({
        id: 'reconciliation-failed',
        severity: 'URGENT',
        kind: 'RECONCILIATION_FAILED',
        actionUrl: null,
        responsibleRole: 'COMMERCIAL_MANAGER',
        contextId: null,
      });
    }

    for (const g of guarantees) {
      if (g.attention === 'EXPIRED') {
        items.push({
          id: `guarantee-expired-${g.id}`,
          severity: 'URGENT',
          kind: 'GUARANTEE_EXPIRED',
          actionUrl: `/projects/${projectId}/commercial/guarantees`,
          responsibleRole: 'COMMERCIAL_MANAGER',
          contextId: g.id,
        });
      } else if (g.attention === 'EXPIRING_SOON') {
        items.push({
          id: `guarantee-expiring-${g.id}`,
          severity: 'WARNING',
          kind: 'GUARANTEE_EXPIRING',
          actionUrl: `/projects/${projectId}/commercial/guarantees`,
          responsibleRole: 'COMMERCIAL_MANAGER',
          contextId: g.id,
        });
      }
    }

    // Effective certificate without an invoice → uninvoiced entitlement.
    const invoicedIpcIds = new Set(invoices.map((i) => i.sourceIpcId).filter(Boolean));
    for (const cert of certs) {
      if (!invoicedIpcIds.has(cert.id)) {
        items.push({
          id: `uninvoiced-${cert.id}`,
          severity: 'WARNING',
          kind: 'UNINVOICED_CERTIFICATE',
          actionUrl: identity.permissions.includes(PERMISSIONS.receivablesManage) ? drill : null,
          responsibleRole: 'COMMERCIAL_MANAGER',
          contextId: cert.id,
        });
      }
    }

    const order = { URGENT: 0, WARNING: 1, INFO: 2 } as const;
    return items.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  private capabilities(
    identity: RequestIdentity,
    contract: MainContract | null,
  ): CommercialCapabilities {
    const has = (p: string) => identity.permissions.includes(p);
    const status = contract?.status ?? null;
    const notTerminal = status !== null && !CommercialTermPolicy.isTerminal(status);

    return {
      canViewFinancials: has(PERMISSIONS.financialPositionView),
      canEditContract:
        has(PERMISSIONS.contractsManage) &&
        status !== null &&
        CommercialTermPolicy.evaluate(status, 'CONTRACT_HEADER').allowed,
      canAdvanceContract: has(PERMISSIONS.contractsApprove) && notTerminal,
      canCreateApplication: has(PERMISSIONS.ipaCreate) && status === 'ACTIVE',
      canReviewApplication: has(PERMISSIONS.ipaApprove),
      canIssueCertificate: has(PERMISSIONS.ipcIssue),
      canGenerateInvoice: has(PERMISSIONS.receivablesManage),
      canManageGuarantee: has(PERMISSIONS.contractsManage) && notTerminal,
    };
  }
}
