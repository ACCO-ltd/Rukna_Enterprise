import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  type CommercialAdvanceSummary,
  type CommercialOutstandingInvoice,
  type CommercialApplicationRow,
  type CommercialApplicationsResponse,
  type CommercialAgingBucket,
  type CommercialAttentionItem,
  type CommercialBillingPosition,
  type CommercialBillingResponse,
  type CommercialCapabilities,
  type ClientInvoiceDocStatus,
  type ClientInvoiceSource,
  type ClientInvoiceSettlementStatus,
  type ArPostingStatus,
  type CommercialInvoiceRow,
  type CommercialReceiptRow,
  type CommercialCurrentCycleResponse,
  type CommercialGuaranteeSummary,
  type CommercialMetric,
  type CommercialNextAction,
  type CommercialPaymentSchedule,
  type CommercialPaymentScheduleInstallment,
  type CommercialPaymentScheduleVariationLine,
  type CommercialSecurityPosition,
  type CommercialSettlementState,
  type CommercialSummaryResponse,
  type PaymentInstallmentBillStatus,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { CommercialTermPolicy } from '../../contracts/domain/commercial-term-policy.js';
import { deriveGuaranteeAttention } from '../../contracts/domain/guarantee-attention-policy.js';
import { CommercialPrismaRepository } from '../infrastructure/commercial-prisma.repository.js';
import { VariationOrderPrismaRepository } from '../../variations/infrastructure/variation-order-prisma.repository.js';
import {
  deriveContractValue,
  netPrice as computeVoNetPrice,
} from '../../variations/domain/variation-order.policy.js';
import type { CommercialContractValue } from '@erp/types';

const ZERO = new Decimal(0);

// ─── Billing helpers ────────────────────────────────────────────────────────────
//
// Pure date/classification rules for the billing read model. Module-level rather than private
// methods because none of them touch instance state, and a rule with no dependencies is far
// easier to reason about (and to test) sitting on its own.

const AGING_BUCKETS: ReadonlyArray<CommercialAgingBucket['bucket']> = [
  'NOT_DUE',
  'DAYS_1_30',
  'DAYS_31_60',
  'DAYS_61_90',
  'DAYS_90_PLUS',
];

/** Midnight UTC for a moment — so "how many days late" counts calendar days, not elapsed hours. */
function utcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Whole UTC days from `dueDate` to `todayUtc`. Negative while the invoice is not yet due. */
function daysBetweenUtc(todayUtc: number, dueDate: Date): number {
  return Math.round((todayUtc - utcMidnight(dueDate)) / 86_400_000);
}

function agingBucket(daysLate: number): CommercialAgingBucket['bucket'] {
  if (daysLate <= 0) return 'NOT_DUE';
  if (daysLate <= 30) return 'DAYS_1_30';
  if (daysLate <= 60) return 'DAYS_31_60';
  if (daysLate <= 90) return 'DAYS_61_90';
  return 'DAYS_90_PLUS';
}

function emptyAging(): CommercialAgingBucket[] {
  return AGING_BUCKETS.map((bucket) => ({ bucket, amount: null, invoiceCount: 0 }));
}

function emptyBillingPosition(): CommercialBillingPosition {
  return {
    invoiced: null,
    collected: null,
    outstanding: null,
    overdue: null,
    postedInvoiceCount: 0,
    overdueInvoiceCount: 0,
    collectionRate: null,
  };
}

/**
 * Where an invoice came from, named the way a reader recognises it (ADR-023): the installment's
 * own name for a MILESTONE contract, the application reference behind the certificate for a
 * measured one. The two links are mutually exclusive by schema; a migration-loaded invoice has
 * neither, and says so rather than borrowing a provenance it does not have.
 */
function invoiceSource(inv: {
  sourceInstallmentId: string | null;
  sourceInstallment: { id: string; name: string; sortOrder: number } | null;
  sourceIpcId: string | null;
  sourceIpc: {
    id: string;
    application: { id: string; applicationRef: string | null; applicationNumber: number | null } | null;
  } | null;
}): ClientInvoiceSource {
  if (inv.sourceInstallmentId) {
    return {
      kind: 'INSTALLMENT',
      label: inv.sourceInstallment?.name ?? null,
      id: inv.sourceInstallmentId,
    };
  }
  if (inv.sourceIpcId) {
    const application = inv.sourceIpc?.application ?? null;
    const label =
      application?.applicationRef ??
      (application?.applicationNumber !== null && application?.applicationNumber !== undefined
        ? `IPA ${application.applicationNumber}`
        : null);
    return { kind: 'IPC', label, id: inv.sourceIpcId };
  }
  return { kind: 'NONE', label: null, id: null };
}

/**
 * The client-facing state of one invoice.
 *
 * Document lifecycle first — a cancelled or draft invoice has no settlement story — then posting,
 * then how much of the *total* has been paid. The comparison is against `totalAmount` and nothing
 * else: an invoice is settled when the client has paid what the invoice asked for, VAT included.
 */
function invoiceSettlementStatus(
  documentStatus: string,
  postingStatus: string,
  total: Decimal,
  balance: Decimal,
): ClientInvoiceSettlementStatus {
  if (documentStatus === 'CANCELLED') return 'CANCELLED';
  if (documentStatus === 'DRAFT') return 'DRAFT';
  if (postingStatus !== 'POSTED') return 'AWAITING_POSTING';
  if (balance.lte(ZERO)) return 'PAID';
  if (balance.gte(total)) return 'UNPAID';
  return 'PARTIALLY_PAID';
}


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
    // ADR-026: the VO set the four derived contract-value figures are computed from.
    private readonly variationRepo: VariationOrderPrismaRepository,
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
        // ADR-026: no main contract → no derived contract value.
        contractValue: null,
        metrics: {
          contractValue: unavailable(),
          certifiedGross: unavailable(),
          certifiedNet: unavailable(),
          invoiced: unavailable(),
          received: unavailable(),
          outstanding: unavailable(),
          uninvoicedCertified: unavailable(),
        },
        // Zero, not unavailable: without a contract there genuinely are no applications,
        // certificates or invoices. The counts are true, and the screen hides the panels.
        certification: {
          applicationsSubmitted: 0,
          effectiveCertificates: 0,
          postedInvoices: 0,
        },
        receivables: { collectionRate: null, outstandingInvoices: [] },
        retention: null,
        advances: [],
        securityPosition: {
          applicable: false,
          retentionHeld: null,
          advanceRecovered: null,
          advanceOutstanding: null,
        },
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
    // The two slices of the same deduction set that are commercial positions in their own right
    // (CONST-COM-005): what the client is still holding back, and how much of the advance has
    // been paid down. Summed here so they can never disagree with certifiedNet.
    let retentionHeld = ZERO;
    let advanceRecovered = ZERO;
    for (const cert of certs) {
      certifiedGross = certifiedGross.plus(new Decimal(cert.certifiedTotal.toString()));
      for (const ded of cert.deductions) {
        const amount = new Decimal(ded.amount.toString());
        certifiedDeductions = certifiedDeductions.plus(amount);
        if (ded.deductionType === 'RETENTION') retentionHeld = retentionHeld.plus(amount);
        else if (ded.deductionType === 'ADVANCE_RECOVERY')
          advanceRecovered = advanceRecovered.plus(amount);
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
        return {
          state: 'RESTRICTED',
          amount: null,
          currency: null,
          sourceCount: 0,
          drillTo: null,
          asOf: asOfIso,
        };
      }
      if (opts.failed) {
        return {
          state: 'FAILED',
          amount: null,
          currency,
          sourceCount: 0,
          drillTo: opts.drillTo,
          asOf: asOfIso,
        };
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

    const guarantees = contract.guarantees.map((g) => this.toGuaranteeSummary(g, asOf));

    const attention = this.buildAttention(
      projectId,
      certs,
      invoices,
      guarantees,
      { certFailed, invoiceFailed },
      identity,
    );

    // Certified work with no posted invoice behind it. Nobody owns this number by default —
    // the certificate is issued, the surveyor has moved on, and the money has not been asked
    // for. Computed from the same effective set, so it can never disagree with certifiedNet.
    const invoicedIpcIds = new Set(
      invoices
        .filter((i) => i.postingStatus === 'POSTED' && i.sourceIpcId)
        .map((i) => i.sourceIpcId!),
    );
    let uninvoicedCertified = ZERO;
    let uninvoicedCount = 0;
    for (const cert of certs) {
      if (invoicedIpcIds.has(cert.id)) continue;
      const deductions = cert.deductions.reduce(
        (sum, d) => sum.plus(new Decimal(d.amount.toString())),
        ZERO,
      );
      uninvoicedCertified = uninvoicedCertified.plus(
        new Decimal(cert.certifiedTotal.toString()).minus(deductions),
      );
      uninvoicedCount += 1;
    }

    // Recent commercial activity spans the contract and its audited children.
    const resourceIds = [
      contract.id,
      ...contract.guarantees.map((g) => g.id),
      ...contract.advanceTerms.map((a) => a.id),
      ...contract.milestones.map((m) => m.id),
      ...certs.map((c) => c.id),
      ...invoices.map((i) => i.id),
    ];
    const [activity, boqVersionNumber, applicationCount, variationInputs] = await Promise.all([
      this.repo.findRecentActivity(prisma, orgId, resourceIds).catch(() => []),
      this.repo.findBoqVersionNumber(prisma, contract.boqVersionId).catch(() => null),
      this.repo.countSubmittedApplications(prisma, orgId, contract.id).catch(() => 0),
      // ADR-026 CONST-VAR-005/006: the VO set for the derived contract-value figures.
      this.variationRepo.findValuationInputs(prisma, orgId, contract.id).catch(() => []),
    ]);

    const contractValueFigures = this.deriveContractValueFigures(
      new Decimal(contract.contractValue.toString()),
      variationInputs,
      mayViewFinancials,
    );

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
        // Withheld like every other figure — the contract value is the most sensitive number
        // on the screen, and leaking it through the identity panel would defeat the metric's
        // RESTRICTED state one card away.
        //
        // ADR-029 T-5 (SEAM, partial): `contract.contractValue` is now the CURRENT value
        // (base + Σ adopted on-contract variations — R6 owns the raise). Total client revenue =
        // currentContractValue + Σ separate charges. The separate-charge source is R7 (ClientInvoice
        // with a null sourceInstallmentId + a source tag, R-4); there is no separate-charge source to
        // read yet, so total client revenue is NOT surfaced here. When R7 lands, aggregate those
        // charges and add a `totalClientRevenue` field alongside this current value — do not fold them
        // into `contractValue` (CONST-BOQ-030: contract value and total client revenue are distinct).
        contractValue: mayViewFinancials ? contract.contractValue.toString() : null,
        currency,
        billingModel: contract.billingModel,
        boqVersionNumber,
      },
      // ADR-026 CONST-VAR-005/006/006a: Original / Approved / Governing / Pending. Derived from the
      // VO set; `Contract.contractValue` (the metric card below) is the immutable original.
      contractValue: contractValueFigures,
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
        uninvoicedCertified: metric({
          failed: certFailed || invoiceFailed,
          amount: uninvoicedCertified,
          sourceCount: uninvoicedCount,
          drillTo: drill.applications,
        }),
      },
      // Counts, not money — how many documents exist is not a commercial secret, so these
      // stay readable without financial visibility. What they are worth does not.
      certification: {
        applicationsSubmitted: applicationCount,
        effectiveCertificates: certs.length,
        postedInvoices: settlement.postedInvoiceCount,
      },
      receivables: {
        collectionRate:
          !mayViewFinancials || invoiceFailed || settlement.invoiced.isZero()
            ? null
            : Math.round(settlement.received.div(settlement.invoiced).mul(100).toNumber()),
        outstandingInvoices: mayViewFinancials
          ? this.outstandingInvoices(invoices, asOf, currency)
          : [],
      },
      retention: contract.retentionTerms
        ? {
            retentionRate: contract.retentionTerms.retentionRate.toString(),
            retentionCap: contract.retentionTerms.retentionCap.toString(),
            retentionSplitOnPC: contract.retentionTerms.retentionSplitOnPC.toString(),
          }
        : null,
      securityPosition: this.securityPosition(
        contract,
        retentionHeld,
        advanceRecovered,
        certFailed,
        mayViewFinancials,
      ),
      advances: contract.advanceTerms.map((a): CommercialAdvanceSummary => ({
        id: a.id,
        advanceType: a.advanceType,
        description: a.description ?? null,
        amount: a.amount?.toString() ?? null,
        percentage: a.percentage?.toString() ?? null,
        recoveryRate: a.recoveryRate.toString(),
      })),
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
        for (const d of effectiveCert.deductions)
          certDed = certDed.plus(new Decimal(d.amount.toString()));
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
        nextAction: this.nextAction(
          ipa.status,
          effectiveCert !== null,
          invoice,
          invoicePosted,
          outstanding,
        ),
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

  async getCurrentCycle(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<CommercialCurrentCycleResponse> {
    const result = await this.getApplications(identity, projectId);
    const asOf = new Date().toISOString();
    const contract = await this.repo.findMainContract(
      this.tenancyService.getClient(),
      identity.activeOrganizationId,
      projectId,
    );

    if (!contract) {
      const allowed = identity.permissions.includes(PERMISSIONS.contractsCreate);
      return {
        projectId,
        contract: null,
        stage: 'NO_CONTRACT',
        application: null,
        nextAction: allowed
          ? { kind: 'CREATE_CONTRACT', href: `/contracts/new?projectId=${projectId}` }
          : null,
        blockers: ['MAIN_CONTRACT_MISSING', ...(allowed ? [] : (['PERMISSION_REQUIRED'] as const))],
        capabilities: result.capabilities,
        responsibleRole: 'CONTRACT_ADMINISTRATOR',
        asOf,
      };
    }

    const identitySummary = {
      id: contract.id,
      contractNumber: contract.contractNumber,
      status: contract.status,
      clientId: contract.client.id,
      clientName: contract.clientNameSnapshot ?? contract.client.name,
    };
    const terminal = CommercialTermPolicy.isTerminal(contract.status);
    if (terminal) {
      return {
        projectId,
        contract: identitySummary,
        stage: 'TERMINAL',
        application: this.selectCurrentApplication(result.applications),
        nextAction: {
          kind: 'VIEW_HISTORY',
          href: `/projects/${projectId}/commercial/applications`,
        },
        blockers: ['CONTRACT_TERMINAL'],
        capabilities: result.capabilities,
        responsibleRole: 'COMMERCIAL_MANAGER',
        asOf,
      };
    }

    if (contract.status !== 'ACTIVE') {
      const mayEdit = result.capabilities.canEditContract;
      const mayAdvance = result.capabilities.canAdvanceContract;
      return {
        projectId,
        contract: identitySummary,
        stage: 'CONTRACT_DRAFT',
        application: null,
        nextAction: mayEdit
          ? { kind: 'EDIT_CONTRACT', href: `/contracts/${contract.id}/edit` }
          : mayAdvance
            ? { kind: 'ADVANCE_CONTRACT', href: `/contracts/${contract.id}` }
            : null,
        blockers: [
          'CONTRACT_NOT_ACTIVE',
          ...(!mayEdit && !mayAdvance ? (['PERMISSION_REQUIRED'] as const) : []),
        ],
        capabilities: result.capabilities,
        responsibleRole: 'CONTRACT_ADMINISTRATOR',
        asOf,
      };
    }

    // ADR-023: a MILESTONE (payment-schedule) contract's cycle is its payment plan, not the IPA
    // chain. Branch before the application path so we never force IPA ceremony onto it.
    if (contract.billingModel === 'MILESTONE') {
      const built = await this.buildPaymentSchedule(identity, contract);
      return {
        projectId,
        contract: identitySummary,
        stage: 'MILESTONE_SCHEDULE',
        application: null,
        paymentSchedule: built.schedule,
        nextAction:
          built.hasFocus && result.capabilities.canGenerateInvoice
            ? {
                kind: 'GENERATE_INVOICE',
                href: `/projects/${projectId}/commercial/billing-collection`,
              }
            : null,
        blockers: [],
        capabilities: result.capabilities,
        responsibleRole: 'COMMERCIAL_MANAGER',
        asOf,
      };
    }

    const application = this.selectCurrentApplication(result.applications);
    if (!application) {
      const allowed = result.capabilities.canCreateApplication;
      return {
        projectId,
        contract: identitySummary,
        stage: 'READY_FOR_APPLICATION',
        application: null,
        nextAction: allowed
          ? { kind: 'CREATE_APPLICATION', href: `/contracts/${contract.id}/applications/new` }
          : null,
        blockers: allowed ? [] : ['PERMISSION_REQUIRED'],
        capabilities: result.capabilities,
        responsibleRole: 'QUANTITY_SURVEYOR',
        asOf,
      };
    }

    const projection = this.projectCycleAction(
      application,
      contract.id,
      projectId,
      result.capabilities,
    );
    return {
      projectId,
      contract: identitySummary,
      application,
      capabilities: result.capabilities,
      asOf,
      ...projection,
    };
  }

  // ─── Billing & Collection — the project's AR position ───────────────────────────

  /**
   * What has been billed to the client and what has been collected against it.
   *
   * Everything here is on the **invoice-total basis**: settlement is measured against what the
   * client was actually asked to pay, never against a pre-VAT certified amount or a plan
   * percentage. Mixing those bases is the specific accounting error this read model exists to
   * make impossible — `subtotal` and `vatAmount` ride along so a screen showing both can label
   * which is which, but every ratio and every balance uses `totalAmount`.
   *
   * Only POSTED invoices count toward the position. A draft invoice is a document somebody is
   * still writing; reporting it as "invoiced" would tell a commercial manager they have asked
   * for money they have not asked for.
   */
  async getBilling(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<CommercialBillingResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const mayViewFinancials = identity.permissions.includes(PERMISSIONS.financialPositionView);
    const asOf = new Date();
    const asOfIso = asOf.toISOString();

    const contract = await this.repo.findMainContract(prisma, orgId, projectId);
    if (!contract) {
      return {
        projectId,
        contractId: null,
        currency: null,
        billingModel: null,
        financialsVisible: mayViewFinancials,
        position: emptyBillingPosition(),
        invoices: [],
        receipts: [],
        clientUnappliedTotal: null,
        aging: emptyAging(),
        capabilities: this.capabilities(identity, null),
        asOf: asOfIso,
      };
    }

    const [invoiceRows, receiptRows, clientUnapplied] = await Promise.all([
      this.repo.findInvoicesForBilling(prisma, orgId, contract.id),
      this.repo.findReceiptsForContract(prisma, orgId, contract.id),
      this.repo
        .sumClientUnappliedReceipts(prisma, orgId, contract.clientId)
        .catch(() => ZERO),
    ]);

    const money = (d: Decimal): string | null => (mayViewFinancials ? d.toFixed(2) : null);
    const today = utcMidnight(asOf);

    let invoiced = ZERO;
    let collected = ZERO;
    let outstanding = ZERO;
    let overdue = ZERO;
    let postedInvoiceCount = 0;
    let overdueInvoiceCount = 0;
    const buckets = new Map<CommercialAgingBucket['bucket'], { amount: Decimal; count: number }>();

    const invoices = invoiceRows.map((inv): CommercialInvoiceRow => {
      const total = new Decimal(inv.totalAmount.toString());
      const balance = new Decimal(inv.outstandingAmount.toString());
      const paid = inv.allocations.reduce(
        (sum, a) => sum.plus(new Decimal(a.allocatedAmount.toString())),
        ZERO,
      );
      const posted = inv.postingStatus === 'POSTED';
      const daysLate = daysBetweenUtc(today, inv.dueDate);
      const isOverdue = posted && balance.gt(ZERO) && daysLate > 0;

      if (posted) {
        postedInvoiceCount += 1;
        invoiced = invoiced.plus(total);
        collected = collected.plus(paid);
        outstanding = outstanding.plus(balance);
        if (balance.gt(ZERO)) {
          const bucket = agingBucket(daysLate);
          const current = buckets.get(bucket) ?? { amount: ZERO, count: 0 };
          buckets.set(bucket, { amount: current.amount.plus(balance), count: current.count + 1 });
        }
        if (isOverdue) {
          overdue = overdue.plus(balance);
          overdueInvoiceCount += 1;
        }
      }

      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        source: invoiceSource(inv),
        invoiceDate: inv.invoiceDate.toISOString(),
        dueDate: inv.dueDate.toISOString(),
        currency: inv.currencyCode,
        subtotal: money(new Decimal(inv.subtotal.toString())),
        vatAmount: money(new Decimal(inv.vatAmount.toString())),
        totalAmount: money(total),
        paidAmount: money(paid),
        outstandingAmount: money(balance),
        documentStatus: inv.documentStatus as ClientInvoiceDocStatus,
        postingStatus: inv.postingStatus as ArPostingStatus,
        status: invoiceSettlementStatus(inv.documentStatus, inv.postingStatus, total, balance),
        daysOverdue: isOverdue ? daysLate : 0,
      };
    });

    const receipts = receiptRows.map((receipt): CommercialReceiptRow => {
      const mine = receipt.clientAllocations.filter(
        (a) => a.invoice?.contractId === contract.id,
      );
      const allocatedHere = mine.reduce(
        (sum, a) => sum.plus(new Decimal(a.allocatedAmount.toString())),
        ZERO,
      );
      return {
        id: receipt.id,
        receiptDate: receipt.receiptDate.toISOString(),
        currency: receipt.currencyCode,
        totalAmount: money(new Decimal(receipt.totalAmount.toString())),
        allocatedAmount: money(new Decimal(receipt.allocatedAmount.toString())),
        unallocatedAmount: money(new Decimal(receipt.unallocatedAmount.toString())),
        allocatedToThisContract: money(allocatedHere),
        paymentMethod: receipt.paymentMethod ?? null,
        // The bank's own reference is what reconciles against a statement; fall back to the
        // free-text reference only when there is no bank one.
        reference: receipt.bankReference ?? receipt.reference ?? null,
        postingStatus: receipt.postingStatus as ArPostingStatus,
        allocations: mine.map((a) => ({
          id: a.id,
          invoiceId: a.clientInvoiceId,
          invoiceNumber: a.invoice?.invoiceNumber ?? null,
          allocatedAmount: money(new Decimal(a.allocatedAmount.toString())),
          allocationDate: a.allocationDate.toISOString(),
        })),
      };
    });

    return {
      projectId,
      contractId: contract.id,
      currency: contract.currency,
      billingModel: contract.billingModel,
      financialsVisible: mayViewFinancials,
      position: {
        invoiced: money(invoiced),
        collected: money(collected),
        outstanding: money(outstanding),
        overdue: money(overdue),
        postedInvoiceCount,
        overdueInvoiceCount,
        // Null rather than 0 when nothing has been invoiced: "0% collected" on a project that
        // has not billed yet reads as a collection failure instead of an empty ledger.
        collectionRate:
          !mayViewFinancials || invoiced.lte(ZERO)
            ? null
            : Math.round(collected.div(invoiced).mul(100).toNumber()),
      },
      invoices,
      receipts,
      clientUnappliedTotal: money(clientUnapplied),
      aging: AGING_BUCKETS.map((bucket) => {
        const entry = buckets.get(bucket);
        return {
          bucket,
          amount: money(entry?.amount ?? ZERO),
          invoiceCount: entry?.count ?? 0,
        };
      }),
      capabilities: this.capabilities(identity, contract),
      asOf: asOfIso,
    };
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────────

  /**
   * ADR-023: build the payment-schedule cycle for a MILESTONE contract. Each installment's status is
   * derived from its **own linked invoice** (ClientInvoice.sourceInstallmentId): un-invoiced →
   * NEXT (the first one, where "Generate invoice" lives) / UPCOMING; invoiced but uncollected →
   * BILLED; posted with partial/full receipts → PARTIALLY_PAID / PAID. Amounts stay on the plan
   * (ex-VAT) basis: `amount = percentage × baseContractValue`, `amountPaid = amount × collected-fraction`
   * of the linked invoice, so the header % and the rows stay coherent.
   *
   * ADR-029 CONST-BOQ-032 / T-6 — the milestone schedule derives from the **frozen** `baseContractValue`,
   * not the current `contractValue`, so raising the current value via a variation (R6) never re-spreads
   * the schedule. Legacy contracts predate the split (M-4): a null base means "= contractValue".
   */
  private async buildPaymentSchedule(
    identity: RequestIdentity,
    contract: MainContract,
  ): Promise<{ schedule: CommercialPaymentSchedule; hasFocus: boolean }> {
    const prisma = this.tenancyService.getClient();
    const mayViewFinancials = identity.permissions.includes(PERMISSIONS.financialPositionView);

    const installments = await this.repo.findPaymentInstallments(prisma, contract.id);
    const invoices = await this.repo.findInvoices(prisma, identity.activeOrganizationId, contract.id);
    // ADR-029 V-3 — adopted on-contract variations are billed as their OWN lines, outside the
    // Σ%=1.0 schedule. A DB failure here must not take the schedule down (same defensive posture as
    // the summary): a missing VO line is a missing separate component, not a broken payment plan.
    type ValuationInput = Awaited<
      ReturnType<VariationOrderPrismaRepository['findValuationInputs']>
    >[number];
    const variationInputs: ValuationInput[] = await this.variationRepo
      .findValuationInputs(prisma, identity.activeOrganizationId, contract.id)
      .catch((): ValuationInput[] => []);
    const byInstallment = new Map(
      invoices.filter((inv) => inv.sourceInstallmentId).map((inv) => [inv.sourceInstallmentId, inv]),
    );
    // T-6 — the schedule is frozen against the base value. Fall back to contractValue for a legacy
    // contract whose base was never set (M-4: never fail a legacy contract).
    const baseValue = new Decimal(
      (contract.baseContractValue ?? contract.contractValue).toString(),
    );

    // Fraction of a posted invoice already collected (0..1). Non-posted invoices count as 0.
    const collectedFraction = (inv: InvoiceRow): Decimal => {
      if (inv.postingStatus !== 'POSTED') return ZERO;
      const total = new Decimal(inv.totalAmount.toString());
      if (total.lte(ZERO)) return ZERO;
      return total.minus(new Decimal(inv.outstandingAmount.toString())).div(total);
    };

    let collected = ZERO;
    let nextAssigned = false;
    const lines: CommercialPaymentScheduleInstallment[] = installments.map((inst) => {
      const amount = baseValue.mul(new Decimal(inst.percentage.toString()));
      const inv = byInstallment.get(inst.id);

      let status: PaymentInstallmentBillStatus;
      let paidFraction = ZERO;
      if (!inv) {
        status = nextAssigned ? 'UPCOMING' : 'NEXT';
        nextAssigned = true;
      } else {
        paidFraction = collectedFraction(inv);
        status = paidFraction.gte(1) ? 'PAID' : paidFraction.gt(ZERO) ? 'PARTIALLY_PAID' : 'BILLED';
      }

      const paid = amount.mul(paidFraction);
      collected = collected.plus(paid);

      return {
        id: inst.id,
        sortOrder: inst.sortOrder,
        name: inst.name,
        percentage: inst.percentage.toString(),
        amount: mayViewFinancials ? amount.toFixed(2) : null,
        amountPaid: mayViewFinancials ? paid.toFixed(2) : null,
        triggerType: inst.triggerType,
        milestoneLabel: inst.milestoneLabel,
        dueOffsetDays: inst.dueOffsetDays,
        dueDate: inst.dueDate ? inst.dueDate.toISOString().slice(0, 10) : null,
        status,
        // CONST-COM-011: the linked programme milestone, so the UI can show the evidence gate
        // and block "Generate invoice" until the milestone is verified. Null when unlinked.
        programmeMilestone: inst.programmeMilestone
          ? {
              id: inst.programmeMilestone.id,
              code: inst.programmeMilestone.code,
              name: inst.programmeMilestone.name,
              status: inst.programmeMilestone.status,
            }
          : null,
      };
    });

    // ADR-029 V-3 / CONST-BOQ-032 — each ADOPTED on-contract variation (boqAppliedAt set — the raise
    // has happened) is a distinct billing line, amount-based (its net Σ line amount), OUTSIDE the
    // Σ%=1.0 milestone `installments` above and NEVER merged into a milestone figure. Stage attachment
    // (which certificate the VO rides) is the R7 seam — `stageInstallmentId` is null in this cut.
    const variationLines: CommercialPaymentScheduleVariationLine[] = variationInputs
      .filter((vo) => vo.status === 'CLIENT_APPROVED' && vo.boqAppliedAt != null)
      .map((vo) => {
        const net = vo.lines.reduce(
          (sum, l) => sum.plus(new Decimal(l.amount.toString())),
          ZERO,
        );
        return {
          variationId: vo.id,
          reference: vo.reference,
          title: vo.title,
          amount: mayViewFinancials ? net.toFixed(2) : null,
          stageInstallmentId: null,
        };
      });

    return {
      schedule: {
        currency: contract.currency,
        // The schedule spreads the frozen base (Σ installment amounts = base), so the header value
        // the % are read against is the base, not the variation-inflated current value (T-6).
        contractValue: mayViewFinancials ? baseValue.toFixed(2) : null,
        totalCollected: mayViewFinancials ? collected.toFixed(2) : null,
        installments: lines,
        variationLines,
      },
      // Focus = there is a first un-invoiced installment (where "Generate invoice" points).
      hasFocus: !nextAssigned ? false : lines.some((l) => l.status === 'NEXT'),
    };
  }

  /**
   * ADR-026 CONST-VAR-005/-006/-006a — derive Original / Approved / Governing / Pending from the
   * VO set. Pure math delegated to the variations domain; only CLIENT_APPROVED counts toward the
   * governing value, PENDING_INTERNAL + INTERNAL_APPROVED are the Pending total (never folded in).
   * Withheld (null) without financial visibility, exactly as the metric cards are.
   */
  private deriveContractValueFigures(
    original: Decimal,
    variations: Array<{ status: string; lines: Array<{ amount: unknown }> }>,
    mayViewFinancials: boolean,
  ): CommercialContractValue {
    if (!mayViewFinancials) {
      return {
        originalContractValue: null,
        approvedVariationsTotal: null,
        governingContractValue: null,
        pendingVariations: null,
      };
    }
    const figures = deriveContractValue(
      original,
      variations.map((v) => ({
        status: v.status as never,
        netPrice: computeVoNetPrice(v.lines.map((l) => ({ amount: new Decimal(String(l.amount)) }))),
      })),
    );
    return {
      originalContractValue: figures.original.toFixed(2),
      approvedVariationsTotal: figures.approvedVariationsTotal.toFixed(2),
      governingContractValue: figures.governing.toFixed(2),
      pendingVariations: figures.pending.toFixed(2),
    };
  }

  /**
   * ADR-017 CONST-COM-005 — retention held and advance recovered, from the certificate deductions
   * that are the only record of either.
   *
   * A MILESTONE contract deducts neither (ADR-023 CONST-COM-013/014), so it reports `applicable:
   * false` rather than three zeros — "we hold no retention on this contract" and "retention is not
   * part of this contract" are different statements, and only one of them is true here.
   *
   * `advanceOutstanding` needs a principal to count down from. An advance term expressed as a
   * percentage with no `amount` has none until somebody derives it, so this returns null rather
   * than inventing one from the contract value.
   */
  private securityPosition(
    contract: MainContract,
    retentionHeld: Decimal,
    advanceRecovered: Decimal,
    certFailed: boolean,
    mayViewFinancials: boolean,
  ): CommercialSecurityPosition {
    const applicable = contract.billingModel !== 'MILESTONE';
    if (!applicable || !mayViewFinancials || certFailed) {
      return {
        applicable,
        retentionHeld: null,
        advanceRecovered: null,
        advanceOutstanding: null,
      };
    }

    const principal = contract.advanceTerms.reduce(
      (sum, term) => (term.amount === null ? sum : sum.plus(new Decimal(term.amount.toString()))),
      ZERO,
    );
    const hasPrincipal = contract.advanceTerms.some((term) => term.amount !== null);

    return {
      applicable: true,
      retentionHeld: retentionHeld.toFixed(2),
      advanceRecovered: advanceRecovered.toFixed(2),
      advanceOutstanding: hasPrincipal
        ? Decimal.max(ZERO, principal.minus(advanceRecovered)).toFixed(2)
        : null,
    };
  }

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
    return {
      invoiced,
      received,
      outstanding: invoiced.minus(received),
      postedInvoiceCount,
      allocationCount,
    };
  }

  /**
   * Posted invoices still carrying a balance, soonest due first, capped at five.
   *
   * `daysOverdue` is measured against the **server** clock in whole UTC calendar days, the
   * same way `guarantee-attention-policy.ts` derives expiry. Whether a client is late is a
   * commercial fact with consequences; a browser with a skewed clock must not get a vote.
   */
  private outstandingInvoices(
    invoices: InvoiceRow[],
    asOf: Date,
    currency: string,
  ): CommercialOutstandingInvoice[] {
    const today = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());

    return invoices
      .filter(
        (inv) =>
          inv.postingStatus === 'POSTED' &&
          new Decimal(inv.outstandingAmount.toString()).greaterThan(0),
      )
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
      .slice(0, 5)
      .map((inv) => {
        const due = Date.UTC(
          inv.dueDate.getUTCFullYear(),
          inv.dueDate.getUTCMonth(),
          inv.dueDate.getUTCDate(),
        );
        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate.toISOString(),
          dueDate: inv.dueDate.toISOString(),
          outstandingAmount: new Decimal(inv.outstandingAmount.toString()).toFixed(2),
          currency,
          daysOverdue: Math.max(0, Math.round((today - due) / 86_400_000)),
        };
      });
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

  private selectCurrentApplication(
    rows: CommercialApplicationRow[],
  ): CommercialApplicationRow | null {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index]!.settlement !== 'PAID') return rows[index]!;
    }
    return rows.at(-1) ?? null;
  }

  private projectCycleAction(
    row: CommercialApplicationRow,
    contractId: string,
    projectId: string,
    capabilities: CommercialCapabilities,
  ): Pick<CommercialCurrentCycleResponse, 'stage' | 'nextAction' | 'blockers' | 'responsibleRole'> {
    const applicationHref = `/contracts/${contractId}/applications/${row.ipaId}`;
    const applicationsHref = `/projects/${projectId}/commercial/applications`;
    const denied = (
      stage: CommercialCurrentCycleResponse['stage'],
      role: CommercialCurrentCycleResponse['responsibleRole'],
    ): Pick<
      CommercialCurrentCycleResponse,
      'stage' | 'nextAction' | 'blockers' | 'responsibleRole'
    > => ({
      stage,
      nextAction: null,
      blockers: ['PERMISSION_REQUIRED'],
      responsibleRole: role,
    });

    if (row.settlement === 'PAID')
      return {
        stage: 'SETTLED',
        nextAction: { kind: 'VIEW_HISTORY', href: applicationsHref },
        blockers: [],
        responsibleRole: null,
      };
    if (row.settlement === 'PARTIALLY_PAID')
      return {
        stage: 'PARTIALLY_PAID',
        nextAction: null,
        blockers: ['RECEIPT_WORKFLOW_UNAVAILABLE'],
        responsibleRole: 'FINANCE_REVIEWER',
      };
    if (row.invoiceId && row.invoicePostingStatus === 'POSTED')
      return {
        stage: 'AWAITING_PAYMENT',
        nextAction: null,
        blockers: ['RECEIPT_WORKFLOW_UNAVAILABLE'],
        responsibleRole: 'FINANCE_REVIEWER',
      };
    if (row.invoiceId)
      return capabilities.canPostInvoice
        ? {
            stage: 'INVOICE_DRAFT',
            nextAction: {
              kind: 'POST_INVOICE',
              href: `/finance/accounting/invoices/${row.invoiceId}`,
            },
            blockers: ['INVOICE_NOT_POSTED'],
            responsibleRole: 'FINANCE_REVIEWER',
          }
        : denied('INVOICE_DRAFT', 'FINANCE_REVIEWER');
    if (row.ipcId)
      return capabilities.canGenerateInvoice
        ? {
            stage: 'AWAITING_INVOICE',
            nextAction: { kind: 'GENERATE_INVOICE', href: applicationHref },
            blockers: [],
            responsibleRole: 'FINANCE_REVIEWER',
          }
        : denied('AWAITING_INVOICE', 'FINANCE_REVIEWER');
    if (row.ipaStatus === 'SUBMITTED')
      return capabilities.canIssueCertificate
        ? {
            stage: 'AWAITING_CERTIFICATION',
            nextAction: { kind: 'ISSUE_CERTIFICATE', href: `${applicationHref}/certificates/new` },
            blockers: ['CERTIFICATE_MISSING'],
            responsibleRole: 'QUANTITY_SURVEYOR',
          }
        : denied('AWAITING_CERTIFICATION', 'QUANTITY_SURVEYOR');
    if (row.ipaStatus === 'PENDING_INTERNAL_APPROVAL')
      return capabilities.canReviewApplication
        ? {
            stage: 'APPLICATION_SUBMITTED',
            nextAction: { kind: 'REVIEW_APPLICATION', href: applicationHref },
            blockers: ['APPLICATION_AWAITING_APPROVAL'],
            responsibleRole: 'COMMERCIAL_MANAGER',
          }
        : denied('APPLICATION_SUBMITTED', 'COMMERCIAL_MANAGER');
    if (row.ipaStatus === 'APPROVED_FOR_SUBMISSION')
      return capabilities.canManageApplication
        ? {
            stage: 'APPLICATION_SUBMITTED',
            nextAction: { kind: 'SUBMIT_APPLICATION', href: applicationHref },
            blockers: [],
            responsibleRole: 'QUANTITY_SURVEYOR',
          }
        : denied('APPLICATION_SUBMITTED', 'QUANTITY_SURVEYOR');
    if (row.ipaStatus === 'RETURNED_FOR_REVISION')
      return capabilities.canManageApplication
        ? {
            stage: 'APPLICATION_RETURNED',
            nextAction: { kind: 'REVISE_APPLICATION', href: applicationHref },
            blockers: [],
            responsibleRole: 'QUANTITY_SURVEYOR',
          }
        : denied('APPLICATION_RETURNED', 'QUANTITY_SURVEYOR');
    return capabilities.canManageApplication
      ? {
          stage: 'APPLICATION_DRAFT',
          nextAction: { kind: 'CONTINUE_APPLICATION', href: applicationHref },
          blockers: [],
          responsibleRole: 'QUANTITY_SURVEYOR',
        }
      : denied('APPLICATION_DRAFT', 'QUANTITY_SURVEYOR');
  }

  private nextAction(
    ipaStatus: string,
    hasEffectiveCert: boolean,
    invoice: InvoiceRow | null,
    invoicePosted: boolean,
    outstanding: Decimal,
  ): CommercialNextAction {
    if (ipaStatus === 'DRAFT' || ipaStatus === 'RETURNED_FOR_REVISION') return 'SUBMIT_APPLICATION';
    if (ipaStatus === 'PENDING_INTERNAL_APPROVAL') return 'REVIEW_APPLICATION';
    if (ipaStatus === 'APPROVED_FOR_SUBMISSION') return 'SUBMIT_APPLICATION';
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
      reference: g.reference ?? null,
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
      canManageApplication: has(PERMISSIONS.ipaManage) && status === 'ACTIVE',
      canReviewApplication: has(PERMISSIONS.ipaApprove),
      canIssueCertificate: has(PERMISSIONS.ipcIssue),
      canGenerateInvoice: has(PERMISSIONS.receivablesManage),
      canPostInvoice: has(PERMISSIONS.receivablesManage),
      canManageGuarantee: has(PERMISSIONS.contractsManage) && notTerminal,
      // These were hardcoded `false` from before the AR receipt endpoints existed. They do now
      // (`POST /customer-receipts`, `POST /customer-receipts/:id/allocations`), so the honest
      // answer is the caller's actual permission — a UI that hides a control the server would
      // accept is as wrong as one that offers a control the server refuses.
      canRecordReceipt: has(PERMISSIONS.receiptsCreate),
      canAllocateReceipt: has(PERMISSIONS.receiptsAllocate) || has(PERMISSIONS.receivablesManage),
    };
  }
}
