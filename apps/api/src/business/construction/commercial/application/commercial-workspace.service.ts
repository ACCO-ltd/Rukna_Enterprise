import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type {
  CommercialClientStatementResponse,
  CommercialDeliveryRecord,
  CommercialInvoiceDocumentResponse,
  CommercialPreparePreviewResponse,
  CommercialTodoItem,
  CommercialWorkspaceResponse,
  ArPostingStatus,
  ClientInvoiceDocStatus,
  ClientInvoiceSettlementStatus,
  InvoiceDeliveryMethod,
  RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { PlatformFileService } from '../../../../platform/files/application/platform-file.service.js';
import { CommercialPrismaRepository } from '../infrastructure/commercial-prisma.repository.js';
import { VariationOrderPrismaRepository } from '../../variations/infrastructure/variation-order-prisma.repository.js';
import { deriveContractValue, netPrice } from '../../variations/domain/variation-order.policy.js';
import { VariationBillingAllocationPolicy } from '../../variations/domain/variation-billing-allocation.policy.js';
import { resolveBoqVisibility } from '../../boq/domain/boq-visibility.policy.js';
import { installmentBillingBlocker } from '../../../accounting/accounts-receivable/domain/installment-billing-eligibility.js';
import { TaxCodeService } from '../../../accounting/accounting-core/application/tax-code.service.js';
import { CommercialService, invoiceSource } from './commercial.service.js';
import {
  buildStatementLines,
  daysPastDue,
  deriveReleasedBy,
  invoiceDocumentCapabilities,
  invoiceLifecycle,
  isUnposted,
  overdueDays,
  parsePaymentTermsDays,
  rankTodo,
  shortContractRef,
  taxLabelFor,
  termsDaysBetween,
  workspaceCapabilities,
  type StatementEntry,
} from '../domain/commercial-workspace.policy.js';

const ZERO = new Decimal(0);
const dec = (v: { toString(): string } | null | undefined): Decimal => new Decimal(v ? v.toString() : 0);
const isoDate = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** The frozen `billingAddressSnapshot` shapes (current + pre-round-3 fallbacks). */
interface InvoiceSnapshot {
  client?: { name: string; address: string | null; taxNumber: string | null } | null;
  description?: string;
  org?: {
    name: string;
    logoFileId: string | null;
    legalAddress: string | null;
    taxRegistrationNumber: string | null;
    invoiceFooterNote: string | null;
  } | null;
  clientName?: string;
  installment?: string;
  separateCharge?: string;
}

/**
 * Commercial tab redesign (2026-09-28, docs/design/commercial-tab-implementation.md §2) — the read
 * models of the redesigned tab: the workspace (bar facts + ranked To do + capabilities), the Prepare
 * dialog preview, the invoice as a document, and the client statement.
 *
 * Read-only. Money follows the one Commercial rule — `resolveBoqVisibility(identity).canViewMargin`,
 * null (never "0") without it. The rules themselves (release, lifecycle, ranking, capabilities,
 * statement balance) live in `domain/commercial-workspace.policy.ts`.
 */
@Injectable()
export class CommercialWorkspaceService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly repo: CommercialPrismaRepository,
    private readonly variationRepo: VariationOrderPrismaRepository,
    private readonly commercial: CommercialService,
    private readonly files: PlatformFileService,
    private readonly taxCodes: TaxCodeService,
  ) {}

  // ─── GET …/commercial/workspace ────────────────────────────────────────────────

  async getWorkspace(identity: RequestIdentity, projectId: string): Promise<CommercialWorkspaceResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const { canViewMargin } = resolveBoqVisibility(identity);
    const money = (d: Decimal | null): string | null => (canViewMargin && d !== null ? d.toFixed(2) : null);
    const asOf = new Date();

    const [contract, project] = await Promise.all([
      this.repo.findMainContract(prisma, orgId, projectId),
      this.repo.findProjectHeader(prisma, orgId, projectId),
    ]);

    if (!contract) {
      return {
        projectId,
        currency: project?.currency ?? 'USD',
        financialsVisible: canViewMargin,
        contract: null,
        signBoq: await this.repo.findLiveBoqVersion(prisma, orgId, projectId),
        facts: { contractValue: null, invoiced: null, collected: null, outstanding: null, overdue: null },
        todo: [],
        capabilities: workspaceCapabilities(identity.permissions, null, canViewMargin),
        asOf: asOf.toISOString(),
      };
    }

    const [built, variationInputs, allocations, invoiceRows, overviewData, signedAgreement, boqVersionNumber] =
      await Promise.all([
        contract.billingModel === 'MILESTONE'
          ? this.commercial.buildPaymentSchedule(identity, contract)
          : Promise.resolve(null),
        this.variationRepo.findValuationInputs(prisma, orgId, contract.id),
        this.repo.findVariationAllocationsForContract(prisma, orgId, contract.id),
        this.repo.findInvoicesForBilling(prisma, orgId, contract.id),
        this.repo.findProjectOverviewData(prisma, orgId, projectId),
        this.repo.findSignedAgreement(prisma, contract.id),
        this.repo.findBoqVersionNumber(prisma, contract.boqVersionId),
      ]);

    // Contract value: the signed (frozen base) value + Σ client-approved variations.
    const signed = dec(contract.baseContractValue ?? contract.contractValue);
    const figures = deriveContractValue(
      signed,
      variationInputs.map((v) => ({
        status: v.status as never,
        netPrice: netPrice(v.lines.map((l) => ({ amount: dec(l.amount) }))),
      })),
    );
    const approvedCount = variationInputs.filter((v) => v.status === 'CLIENT_APPROVED').length;

    // Bar facts — the overview's figures (posted invoices, net of posted credit notes), one overdue rule.
    const grossIssued = overviewData.invoices.reduce((s, i) => s.plus(i.totalAmount), ZERO);
    const outstanding = overviewData.invoices.reduce((s, i) => s.plus(i.outstandingAmount), ZERO);
    const overdue = overviewData.invoices.reduce(
      (s, i) => (i.dueDate && daysPastDue(i.dueDate, asOf) > 0 && i.outstandingAmount.gt(ZERO) ? s.plus(i.outstandingAmount) : s),
      ZERO,
    );

    const todo = this.buildTodo({
      contractStatus: contract.status,
      installments: built?.schedule.installments ?? [],
      variationInputs,
      allocations,
      invoiceRows,
      asOf,
      money,
    });

    return {
      projectId,
      currency: contract.currency,
      financialsVisible: canViewMargin,
      contract: {
        id: contract.id,
        contractNumber: contract.contractNumber,
        shortRef: shortContractRef(contract.contractNumber, project?.code ?? null),
        status: contract.status,
        billingModel: contract.billingModel,
        clientId: contract.clientId,
        clientName: contract.clientNameSnapshot ?? contract.client.name,
        signedDate: isoDate(contract.signedDate),
        startDate: isoDate(contract.startDate),
        expectedEndDate: isoDate(contract.expectedEndDate),
        paymentTermsDays: parsePaymentTermsDays(contract.paymentTerms),
        signedValue: money(figures.original),
        approvedVariationsValue: money(figures.approvedVariationsTotal),
        approvedVariationCount: approvedCount,
        currentValue: money(figures.governing),
        signedBoq:
          boqVersionNumber !== null ? { versionId: contract.boqVersionId, versionNumber: boqVersionNumber } : null,
        signedAgreement,
      },
      signBoq: null,
      facts: {
        contractValue: money(figures.governing),
        invoiced: money(grossIssued.minus(overviewData.postedCreditNotesSum)),
        collected: money(overviewData.collectedSum),
        outstanding: money(outstanding),
        overdue: money(overdue),
      },
      todo,
      capabilities: workspaceCapabilities(identity.permissions, contract, canViewMargin),
      asOf: asOf.toISOString(),
    };
  }

  /** The To do rows (spec §2), ranked. Exposed for unit testing through `getWorkspace`. */
  private buildTodo(input: {
    contractStatus: string;
    installments: Awaited<ReturnType<CommercialService['buildPaymentSchedule']>>['schedule']['installments'];
    variationInputs: Awaited<ReturnType<VariationOrderPrismaRepository['findValuationInputs']>>;
    allocations: Awaited<ReturnType<CommercialPrismaRepository['findVariationAllocationsForContract']>>;
    invoiceRows: Awaited<ReturnType<CommercialPrismaRepository['findInvoicesForBilling']>>;
    asOf: Date;
    money: (d: Decimal | null) => string | null;
  }): CommercialTodoItem[] {
    const { installments, allocations, invoiceRows, asOf, money } = input;
    const stageCount = installments.length;
    const stageNo = new Map(installments.map((inst, i) => [inst.id, i + 1]));
    const stageName = new Map(installments.map((inst) => [inst.id, inst.name]));

    // Variation invoices: invoiceId → its VO, and → the stage it rides with.
    const voByInvoice = new Map<string, { reference: string; title: string; installmentId: string | null }>();
    const allocatedByVariation = new Map<string, Decimal>();
    for (const a of allocations) {
      allocatedByVariation.set(a.variationId, (allocatedByVariation.get(a.variationId) ?? ZERO).plus(dec(a.amount)));
      if (a.treatment === 'INVOICE' && a.clientInvoiceId) {
        voByInvoice.set(a.clientInvoiceId, { ...a.variation, installmentId: a.installmentId });
      }
    }

    const sourceLabel = (inv: (typeof invoiceRows)[number]): string | null => {
      if (inv.sourceInstallmentId) {
        const n = stageNo.get(inv.sourceInstallmentId);
        const name = inv.sourceInstallment?.name ?? stageName.get(inv.sourceInstallmentId) ?? '';
        return n ? `Stage ${n} · ${name}` : name || null;
      }
      if (inv.sourceBoqNode) {
        return `Separate charge · ${inv.sourceBoqNode.code} ${inv.sourceBoqNode.description}`.trim();
      }
      const vo = voByInvoice.get(inv.id);
      if (vo) return `Variation · ${vo.reference} ${vo.title}`;
      const src = invoiceSource(inv);
      return src.kind === 'IPC' && src.label ? `Certificate · ${src.label}` : null;
    };

    const items: CommercialTodoItem[] = [];
    const base = {
      invoiceId: null,
      invoiceNumber: null,
      installmentId: null,
      installmentName: null,
      stageNumber: null,
      stageCount: null,
      sourceLabel: null,
      amount: null,
      dueDate: null,
      daysOverdue: null,
      releasedBy: null,
      blocker: null,
      unbilledVariations: null,
      createdAt: null,
    } satisfies Omit<CommercialTodoItem, 'id' | 'kind'>;

    // Stage drafts that exist, so a VO draft riding with one is folded into the stage's row.
    const stagesWithDraft = new Set(
      invoiceRows
        .filter((i) => i.sourceInstallmentId && i.documentStatus !== 'CANCELLED' && isUnposted(i.postingStatus))
        .map((i) => i.sourceInstallmentId!),
    );
    const draftTotalByStage = new Map<string, Decimal>();
    for (const inv of invoiceRows) {
      if (inv.documentStatus === 'CANCELLED' || !isUnposted(inv.postingStatus)) continue;
      const stage = inv.sourceInstallmentId ?? voByInvoice.get(inv.id)?.installmentId ?? null;
      if (stage) draftTotalByStage.set(stage, (draftTotalByStage.get(stage) ?? ZERO).plus(dec(inv.totalAmount)));
    }

    for (const inv of invoiceRows) {
      if (inv.documentStatus === 'CANCELLED') continue;
      const total = dec(inv.totalAmount);
      const balance = dec(inv.outstandingAmount);
      const stageId = inv.sourceInstallmentId ?? voByInvoice.get(inv.id)?.installmentId ?? null;
      const common = {
        ...base,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        installmentId: stageId,
        installmentName: stageId ? (stageName.get(stageId) ?? null) : null,
        stageNumber: stageId ? (stageNo.get(stageId) ?? null) : null,
        stageCount: stageId ? stageCount : null,
        sourceLabel: sourceLabel(inv),
        dueDate: isoDate(inv.dueDate),
      };

      if (isUnposted(inv.postingStatus)) {
        // One row per package: a VO draft riding on a stage with its own draft is part of that row.
        if (!inv.sourceInstallmentId && stageId && stagesWithDraft.has(stageId)) continue;
        items.push({
          ...common,
          id: `draft:${inv.id}`,
          kind: 'DRAFT_INVOICE',
          amount: money(inv.sourceInstallmentId ? (draftTotalByStage.get(inv.sourceInstallmentId) ?? total) : total),
          createdAt: inv.createdAt.toISOString(),
        });
        continue;
      }
      if (inv.postingStatus !== 'POSTED' || !balance.gt(ZERO)) continue;

      const late = overdueDays({ posted: true, dueDate: inv.dueDate, balance }, asOf);
      if (late > 0) {
        items.push({ ...common, id: `overdue:${inv.id}`, kind: 'OVERDUE_INVOICE', amount: money(balance), daysOverdue: late });
      } else if (inv.deliveries.length === 0) {
        items.push({ ...common, id: `unsent:${inv.id}`, kind: 'ISSUED_NOT_SENT', amount: money(balance) });
      }
    }

    // Client-approved variations still to bill — they can ride on any stage invoice prepared now.
    const unbilled = input.variationInputs
      .filter((v) => v.status === 'CLIENT_APPROVED')
      .map((v) => ({
        reference: v.reference,
        remaining: remainingToBill(v.lines, allocatedByVariation.get(v.id)),
      }))
      .filter((v) => !v.remaining.isZero());
    const unbilledVariations =
      unbilled.length > 0
        ? {
            count: unbilled.length,
            amount: money(unbilled.reduce((s, v) => s.plus(v.remaining), ZERO)),
            references: unbilled.map((v) => v.reference),
          }
        : null;

    let blockedAdded = false;
    for (const inst of installments) {
      if (inst.invoiceId !== null) continue;
      const stage = {
        ...base,
        installmentId: inst.id,
        installmentName: inst.name,
        stageNumber: stageNo.get(inst.id) ?? null,
        stageCount,
        amount: inst.amount,
        dueDate: inst.dueDate,
        releasedBy: inst.releasedBy,
      };
      if (inst.billingBlocker === null) {
        // Prepare refuses unless the contract is ACTIVE; never offer what the server refuses.
        if (input.contractStatus !== 'ACTIVE') continue;
        // A Date stage bills on its date: it has no raise blocker, but it is not work to do yet.
        if (!stageDue(inst, asOf)) continue;
        items.push({ ...stage, id: `ready:${inst.id}`, kind: 'READY_TO_INVOICE', unbilledVariations });
      } else if (!blockedAdded) {
        blockedAdded = true;
        items.push({ ...stage, id: `blocked:${inst.id}`, kind: 'BLOCKED_STAGE', blocker: inst.billingBlocker });
      }
    }

    return rankTodo(items);
  }

  // ─── GET …/installments/:installmentId/prepare-preview ─────────────────────────

  async getPreparePreview(
    identity: RequestIdentity,
    projectId: string,
    installmentId: string,
  ): Promise<CommercialPreparePreviewResponse> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const installment = await this.repo.findInstallmentWithContract(prisma, orgId, installmentId);
    if (!installment || installment.contract.projectId !== projectId) {
      throw new NotFoundException(`Payment installment ${installmentId} not found on project ${projectId}`);
    }
    await this.projectAccess.assertMember(identity, projectId);
    if (installment.clientInvoice && installment.clientInvoice.documentStatus !== 'CANCELLED') {
      throw new BadRequestException({
        message: `"${installment.name}" already has an invoice.`,
        code: 'STAGE_ALREADY_INVOICED',
        errorCode: 'STAGE_ALREADY_INVOICED',
      });
    }
    const contract = installment.contract;
    const { canViewMargin } = resolveBoqVisibility(identity);
    const money = (d: Decimal): string | null => (canViewMargin ? d.toFixed(2) : null);

    const [installments, variationInputs, allocations] = await Promise.all([
      this.repo.findPaymentInstallments(prisma, contract.id),
      this.variationRepo.findValuationInputs(prisma, orgId, contract.id),
      this.repo.findVariationAllocationsForContract(prisma, orgId, contract.id),
    ]);
    const index = installments.findIndex((i) => i.id === installmentId);
    const row = installments[index]!;

    const blocker =
      installmentBillingBlocker({ ...installment, contractStatus: contract.status }) ??
      (contract.status === 'ACTIVE' ? null : 'CONTRACT_NOT_ACTIVE');

    const allocated = new Map<string, Decimal>();
    for (const a of allocations) {
      allocated.set(a.variationId, (allocated.get(a.variationId) ?? ZERO).plus(dec(a.amount)));
    }
    const variations = variationInputs
      .filter((v) => v.status === 'CLIENT_APPROVED')
      .map((v) => ({
        v,
        remaining: remainingToBill(v.lines, allocated.get(v.id)),
      }))
      .filter(({ remaining }) => !remaining.isZero())
      .map(({ v, remaining }) => ({
        variationId: v.id,
        reference: v.reference,
        title: v.title,
        treatment: remaining.gt(ZERO) ? ('INVOICE' as const) : ('STAGE_REDUCTION' as const),
        amount: money(remaining),
        defaultSelected: true,
      }));

    const pct = dec(installment.percentage);
    const defaultTax = await this.taxCodes.defaultOutput(prisma, orgId);
    return {
      installmentId,
      stageNumber: index + 1,
      stageCount: installments.length,
      stageName: installment.name,
      percentage: pct.toFixed(4),
      releasedBy: deriveReleasedBy({
        triggerType: row.triggerType,
        dueDate: row.dueDate,
        programmeMilestone: row.programmeMilestone,
      }),
      blocker,
      currency: contract.currency,
      stageAmount: money(dec(contract.baseContractValue ?? contract.contractValue).mul(pct).toDecimalPlaces(2)),
      variations,
      // ADR-041 — the default sales tax code the drafts are raised at unless Finance picks another;
      // the same rule the invoice generator applies, never re-keyed here.
      taxRate: defaultTax ? new Decimal(defaultTax.ratePercent).div(100).toString() : null,
      defaultTaxCode: defaultTax
        ? { id: defaultTax.id, code: defaultTax.code, name: defaultTax.name, ratePercent: defaultTax.ratePercent }
        : null,
    };
  }

  // ─── GET …/commercial/invoices/:invoiceId ──────────────────────────────────────

  async getInvoiceDocument(
    identity: RequestIdentity,
    projectId: string,
    invoiceId: string,
  ): Promise<CommercialInvoiceDocumentResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const inv = await this.repo.findInvoiceDocument(prisma, orgId, projectId, invoiceId);
    if (!inv) throw new NotFoundException(`Invoice ${invoiceId} not found on project ${projectId}`);

    const { canViewMargin } = resolveBoqVisibility(identity);
    const money = (d: Decimal): string | null => (canViewMargin ? d.toFixed(2) : null);
    const posted = !isUnposted(inv.postingStatus);
    const snapshot = (inv.billingAddressSnapshot ?? {}) as InvoiceSnapshot;

    const [liveOrg, project, contractNumber, createdByName, paymentsOpen] = await Promise.all([
      // D5: drafts show the organisation's CURRENT branding; issued invoices their frozen snapshot
      // (falling back to live only for pre-snapshot invoices that never froze one).
      posted && snapshot.org ? Promise.resolve(null) : this.repo.findOrgBranding(prisma, orgId),
      this.repo.findProjectHeader(prisma, orgId, projectId),
      inv.contractId ? this.repo.findContractNumber(prisma, orgId, inv.contractId) : Promise.resolve(null),
      this.repo.findUserName(prisma, orgId, inv.createdBy).catch(() => null),
      this.repo.hasActiveContract(prisma, orgId, projectId),
    ]);
    const org = posted && snapshot.org ? snapshot.org : liveOrg;
    const logoUrl = org?.logoFileId
      ? await this.files
          .getDownloadUrl(identity, org.logoFileId)
          .then((r) => r.url)
          .catch(() => null) // a replaced/unreadable logo renders as "no logo", never an error
      : null;

    const subtotal = dec(inv.subtotal);
    const tax = dec(inv.vatAmount);
    const total = dec(inv.totalAmount);
    const balance = posted ? dec(inv.outstandingAmount) : total;
    const description =
      snapshot.description ?? snapshot.installment ?? snapshot.separateCharge ?? `Invoice ${inv.invoiceNumber ?? ''}`.trim();

    const voAddition = inv.variationBillingAllocations.find((a) => a.treatment === 'INVOICE');
    let lines: CommercialInvoiceDocumentResponse['lines'];
    if (inv.sourceInstallment) {
      const reductions = inv.variationBillingAllocations.filter((a) => a.treatment === 'STAGE_REDUCTION');
      const reduced = reductions.reduce((s, r) => s.plus(dec(r.amount)), ZERO);
      const pct = dec(inv.sourceInstallment.percentage).mul(100).toDecimalPlaces(2);
      lines = [
        { description, detail: `${pct.toString()}% of contract value`, amount: money(subtotal.minus(reduced)) },
        ...reductions.map((r) => ({
          description: `${r.variation.reference} — ${r.variation.title}`,
          detail: 'Omission',
          amount: money(dec(r.amount)),
        })),
      ];
    } else {
      const detail = voAddition ? 'Variation' : inv.sourceBoqNodeId ? 'Separate charge' : null;
      lines = [{ description, detail, amount: money(subtotal) }];
    }

    const source = invoiceSource(inv);
    if (source.kind === 'NONE' && voAddition) {
      source.label = `${voAddition.variation.reference} — ${voAddition.variation.title}`;
    }

    const lifecycle = invoiceLifecycle({
      documentStatus: inv.documentStatus,
      postingStatus: inv.postingStatus,
      balance,
      deliveryCount: inv.deliveries.length,
    });

    const settlementStatus: ClientInvoiceSettlementStatus =
      inv.documentStatus === 'CANCELLED'
        ? 'CANCELLED'
        : inv.documentStatus === 'DRAFT'
          ? 'DRAFT'
          : inv.postingStatus !== 'POSTED'
            ? 'AWAITING_POSTING'
            : balance.lte(ZERO)
              ? 'PAID'
              : balance.gte(total)
                ? 'UNPAID'
                : 'PARTIALLY_PAID';

    return {
      id: inv.id,
      projectId,
      invoiceNumber: inv.invoiceNumber,
      documentStatus: inv.documentStatus as ClientInvoiceDocStatus,
      postingStatus: inv.postingStatus as ArPostingStatus,
      settlementStatus,
      lifecycle,
      issuer: {
        name: org?.name ?? '',
        legalAddress: org?.legalAddress ?? null,
        taxRegistrationNumber: org?.taxRegistrationNumber ?? null,
        logoUrl,
        footerNote: org?.invoiceFooterNote ?? null,
      },
      billTo: {
        name: snapshot.client?.name ?? snapshot.clientName ?? inv.client.name,
        address: snapshot.client ? snapshot.client.address : inv.client.address,
      },
      invoiceDate: isoDate(inv.invoiceDate),
      dueDate: isoDate(inv.dueDate),
      paymentTermsDays: termsDaysBetween(inv.invoiceDate, inv.dueDate),
      projectCode: project?.code ?? null,
      contractNumber,
      currency: inv.currencyCode,
      lines,
      subtotal: money(subtotal),
      taxLabel: taxLabelFor(subtotal, tax, inv.taxRate ? dec(inv.taxRate) : null),
      taxAmount: money(tax),
      total: money(total),
      balanceDue: money(balance),
      source,
      journalEntryId: inv.postedJournalEntryId,
      deliveries: inv.deliveries.map(
        (d): CommercialDeliveryRecord => ({
          id: d.id,
          method: d.method as InvoiceDeliveryMethod,
          recipient: d.recipient,
          note: d.note,
          sentAt: d.sentAt.toISOString(),
          sentBy: d.sentBy,
        }),
      ),
      createdAt: inv.createdAt.toISOString(),
      createdBy: createdByName ?? inv.createdBy,
      financialsVisible: canViewMargin,
      capabilities: invoiceDocumentCapabilities(identity.permissions, lifecycle, balance, paymentsOpen),
    };
  }

  // ─── GET …/commercial/statement ────────────────────────────────────────────────

  async getStatement(identity: RequestIdentity, projectId: string): Promise<CommercialClientStatementResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const { canViewMargin } = resolveBoqVisibility(identity);
    const asOf = new Date().toISOString();

    const contract = await this.repo.findMainContract(prisma, orgId, projectId);
    if (!contract) {
      const project = await this.repo.findProjectHeader(prisma, orgId, projectId);
      return {
        projectId,
        contractNumber: null,
        clientName: null,
        currency: project?.currency ?? 'USD',
        asOf,
        lines: [],
        closingBalance: canViewMargin ? '0.00' : null,
      };
    }

    const data = await this.repo.findStatementData(prisma, orgId, contract.id);
    const numberOf = new Map(data.invoices.map((i) => [i.id, i.invoiceNumber]));
    let seq = 0;
    const entries: StatementEntry[] = [
      ...data.invoices.map((i) => ({
        date: i.invoiceDate,
        kind: 'INVOICE' as const,
        reference: i.invoiceNumber,
        description: ((i.billingAddressSnapshot ?? {}) as InvoiceSnapshot).description ?? 'Invoice',
        amount: dec(i.totalAmount),
        sequence: seq++,
      })),
      ...data.creditNotes.map((cn) => ({
        date: cn.accountingDate,
        kind: 'CREDIT_NOTE' as const,
        reference: cn.creditNoteNumber,
        description: `Credit note against ${numberOf.get(cn.invoiceId) ?? 'invoice'}`,
        amount: dec(cn.totalAmount),
        sequence: seq++,
      })),
      ...data.allocations.map((a) => ({
        date: a.allocationDate,
        kind: 'RECEIPT' as const,
        reference: a.receipt.receiptNumber ?? a.receipt.bankReference ?? a.receipt.reference ?? null,
        description: `Payment against ${numberOf.get(a.clientInvoiceId) ?? 'invoice'}`,
        amount: dec(a.allocatedAmount),
        sequence: seq++,
      })),
    ];

    return {
      projectId,
      contractNumber: contract.contractNumber,
      clientName: contract.clientNameSnapshot ?? contract.client.name,
      currency: contract.currency,
      asOf,
      ...buildStatementLines(entries, canViewMargin),
    };
  }
}

/**
 * What of a client-approved variation is still to bill. Goes through the same allocation policy
 * the prepare command uses, so the To do row, the preview and the invoice cannot disagree by a cent.
 */
function remainingToBill(lines: ReadonlyArray<{ amount: Decimal | string | number }>, allocated: Decimal | undefined): Decimal {
  const net = netPrice(lines.map((l) => ({ amount: dec(l.amount) })));
  return VariationBillingAllocationPolicy.remainingUnallocated(net, allocated ? [{ amount: allocated }] : []);
}

/** A TIME_BASED stage is due once its date (server clock, UTC day) has arrived; other stages are due when unblocked. */
function stageDue(inst: { triggerType: string; dueDate: string | null }, asOf: Date): boolean {
  if (inst.triggerType !== 'TIME_BASED' || !inst.dueDate) return true;
  return inst.dueDate.slice(0, 10) <= asOf.toISOString().slice(0, 10);
}
