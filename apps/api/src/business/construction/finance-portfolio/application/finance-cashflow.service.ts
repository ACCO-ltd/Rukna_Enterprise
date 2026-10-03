import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  type CashflowForecastQuery,
  type CashflowForecastResponse,
  type CashflowLineType,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { ProjectProcurementRepository } from '../../../procurement/project-procurement/infrastructure/project-procurement.repository.js';
import { addStage, emptyStageTotals, type StageTotals } from '../../../procurement/project-procurement/domain/project-cost-rollup.js';
import { resolveBoqVisibility } from '../../boq/domain/boq-visibility.policy.js';
import {
  deriveExpectedDate,
  deriveInvoiceState,
  resolveInvoiceDates,
} from '../../commercial/domain/commercial-workspace.policy.js';
import { scheduleBaseValue } from '../../commercial/domain/receivable-position.js';
import { CommercialPrismaRepository } from '../../commercial/infrastructure/commercial-prisma.repository.js';
import {
  buildForecast,
  buildGrid,
  expectedBillDate,
  expectedCommitmentPayDate,
  type CashflowItem,
} from '../domain/cashflow-forecast.policy.js';
import { findBillsToPay } from '../infrastructure/bills-to-pay.query.js';

/** The plain-words assumptions behind each line — returned with every forecast. */
export const CASHFLOW_BASIS: Record<CashflowLineType, string> = {
  fromInvoices:
    'Outstanding balance of issued (posted) client invoices — the same outstanding figure as Finance → Projects — ' +
    'expected on each invoice’s due date. Invoices already past due are shown under “Overdue / now”.',
  fromUnbilledStages:
    'Payment-schedule stages of active client contracts that are not yet invoiced (a prepared draft counts as not ' +
    'invoiced), at the stage’s share of the base contract value. Expected bill date: the linked milestone’s forecast ' +
    '(else baseline) date, or the stage’s own date, or the day it was marked ready to bill if earlier; a date already ' +
    'past counts as today. Expected payment: bill date + the contract’s payment terms (none → due on receipt). ' +
    'Stages with no date are “Undated”.',
  fromSupplierBills:
    'Outstanding balance of posted supplier bills coded to the project — the same bills as “To pay” — expected on each ' +
    'bill’s due date. Bills already past due are shown under “Overdue / now”.',
  fromOpenCommitments:
    'Purchase-order value ordered or received but not yet billed (commitment ledger committed + accrued, per order). ' +
    'Expected payment: the order’s expected delivery date + the supplier’s payment terms; either missing → “Undated”.',
};

export const CASHFLOW_EXCLUSIONS: string[] = [
  'The cash already in the bank — cumulative net starts from zero, not from today’s bank balance.',
  'Invoices, bills and orders not coded to a project.',
  'Variations billed as separate charges until they are invoiced, and tax an invoice adds on top of a stage amount.',
  'Stages of contracts that are not active yet.',
];

/**
 * ADR-043 Phase 4 — the cash-flow forecast. Read-only and batched; every amount comes from the
 * definition the portfolio and the per-project screens already use:
 *
 * - invoices: `findPostedReceivablesByProject` (the receivable position's `outstanding`);
 * - unbilled stages: the payment schedule's `deriveInvoiceState` / `deriveExpectedDate`, priced by
 *   `scheduleBaseValue` × percentage, terms by `resolveInvoiceDates` (the prepare/issue default);
 * - supplier bills: `findBillsToPay` (the portfolio's `billsToPay`);
 * - open commitments: the commitment ledger folded by `addStage` — committed + accrued =
 *   committed-to-date − actual.
 */
@Injectable()
export class FinanceCashflowService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly commercialRepo: CommercialPrismaRepository,
    private readonly procurementRepo: ProjectProcurementRepository,
  ) {}

  async forecast(identity: RequestIdentity, query: CashflowForecastQuery = {}): Promise<CashflowForecastResponse> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const today = new Date();
    const size = query.bucket ?? 'WEEK';
    // Same money gate as the portfolio: receivables follow the margin tier, cost the Finance Overview.
    const moneyVisible =
      resolveBoqVisibility(identity).canViewMargin && identity.permissions.includes(PERMISSIONS.financialPositionView);

    if (query.projectId) await this.projectAccess.assertMember(identity, query.projectId);
    const accessible = await this.projectAccess.accessibleProjectIds(identity);
    const projects = await prisma.project.findMany({
      where: {
        organizationId: orgId,
        ...(accessible ? { id: { in: accessible } } : {}),
        ...(query.projectId ? { id: query.projectId } : {}),
      },
      select: { id: true },
    });
    const ids = projects.map((p) => p.id);

    const [contracts, receivables, bills, ledger] = await Promise.all([
      ids.length ? this.commercialRepo.findMainContractsByProject(prisma, orgId, ids) : Promise.resolve(new Map()),
      this.commercialRepo.findPostedReceivablesByProject(prisma, orgId, ids),
      findBillsToPay(prisma, orgId, ids),
      this.procurementRepo.groupByProjectPurchaseOrderAndStage(prisma, orgId, ids),
    ]);
    const activeContracts = [...contracts.values()].filter((c) => c.status === 'ACTIVE');
    const contractById = new Map(activeContracts.map((c) => [c.id, c]));

    const poIds = [...new Set(ledger.map((r) => r.purchaseOrderId).filter((id): id is string => id !== null))];
    const [stages, poFacts] = await Promise.all([
      this.commercialRepo.findScheduleStagesForForecast(prisma, [...contractById.keys()]),
      this.procurementRepo.findPurchaseOrderPaymentFacts(prisma, orgId, poIds),
    ]);

    const items: CashflowItem[] = [];

    // ── Inflows: posted invoices' outstanding, on their due dates ────────────────────────
    for (const rec of receivables.values()) {
      for (const inv of rec.invoices) {
        if (inv.outstandingAmount.isZero()) continue;
        items.push({ line: 'fromInvoices', currency: inv.currencyCode, amount: inv.outstandingAmount, date: inv.dueDate });
      }
    }

    // ── Inflows: stages not yet invoiced, on bill date + contract terms ─────────────────
    for (const stage of stages) {
      if (deriveInvoiceState(stage.clientInvoice) === 'ISSUED') continue; // already in invoices
      const contract = contractById.get(stage.contractId);
      if (!contract) continue;
      const amount = scheduleBaseValue(contract).mul(stage.percentage.toString());
      if (amount.isZero()) continue;
      const billDate = expectedBillDate({
        expectedDate: deriveExpectedDate(stage),
        readyToBillAt: stage.readyToBillAt,
        today,
      });
      const date = billDate
        ? new Date(
            `${resolveInvoiceDates({ invoiceDate: billDate.toISOString().slice(0, 10) }, contract.paymentTerms, today).dueDate}T00:00:00Z`,
          )
        : null;
      items.push({ line: 'fromUnbilledStages', currency: contract.currency, amount, date });
    }

    // ── Outflows: posted supplier bills' outstanding, on their due dates ────────────────
    for (const bill of bills) {
      items.push({
        line: 'fromSupplierBills',
        currency: bill.currencyCode,
        amount: new Decimal(bill.outstandingAmount.toString()),
        date: bill.dueDate,
      });
    }

    // ── Outflows: open commitments per order, on delivery + supplier terms ──────────────
    const open = new Map<string, { currency: string; purchaseOrderId: string | null; totals: StageTotals }>();
    for (const row of ledger) {
      const key = `${row.projectId}|${row.purchaseOrderId ?? ''}|${row.currencyCode}`;
      const entry = open.get(key) ?? { currency: row.currencyCode, purchaseOrderId: row.purchaseOrderId, totals: emptyStageTotals() };
      addStage(entry.totals, row.stage, new Decimal(row._sum.amount?.toString() ?? 0));
      open.set(key, entry);
    }
    for (const entry of open.values()) {
      const amount = entry.totals.committed.plus(entry.totals.accrued);
      if (!amount.gt(0)) continue; // fully billed (or a reversal artefact) — nothing still to pay
      const facts = entry.purchaseOrderId ? poFacts.get(entry.purchaseOrderId) : undefined;
      items.push({
        line: 'fromOpenCommitments',
        currency: entry.currency,
        amount,
        date: facts ? expectedCommitmentPayDate(facts.expectedDeliveryDate, facts.supplierTermsDays) : null,
      });
    }

    const grid = buildGrid({
      today,
      from: query.from ? new Date(`${query.from.slice(0, 10)}T00:00:00Z`) : null,
      to: query.to ? new Date(`${query.to.slice(0, 10)}T00:00:00Z`) : null,
      size,
    });

    return {
      currencies: buildForecast(items, grid, moneyVisible),
      bucket: size,
      from: grid.periods[0]!.start.toISOString().slice(0, 10),
      to: grid.periods.at(-1)!.end.toISOString().slice(0, 10),
      projectId: query.projectId ?? null,
      basis: CASHFLOW_BASIS,
      exclusions: CASHFLOW_EXCLUSIONS,
      moneyVisible,
      asOf: today.toISOString(),
    };
  }
}
