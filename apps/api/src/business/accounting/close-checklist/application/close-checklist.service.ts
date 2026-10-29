import { Injectable, NotFoundException } from '@nestjs/common';
import type { CloseCheck, CloseCheckStatus, CloseChecklist, RequestIdentity } from '@erp/types';

import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { PeriodManagementService } from '../../general-ledger/application/period-management.service.js';
import { VatReportService } from '../../vat-report/application/vat-report.service.js';
import { CloseChecklistRepository } from '../infrastructure/close-checklist.repository.js';

const BASE = '/finance/accounting';
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Step 6 — the month-end close checklist for one period, read live: everything dated in the month
 * posted, every bank account reconciled to the month's end, the AR and AP control accounts tied out
 * to their subledgers, the month's VAT, then lock and close. A check is done when the data says so;
 * there is no stored tick to fall out of date.
 *
 * The checks that block closing are the close gate's own (PeriodManagementService), so the
 * checklist and the Close button never disagree. Bank reconciliation blocks only when the
 * organisation's banking policy says so; otherwise it is shown and left to judgement.
 */
@Injectable()
export class CloseChecklistService {
  constructor(
    private readonly repo: CloseChecklistRepository,
    private readonly periods: PeriodManagementService,
    private readonly vat: VatReportService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  async checklist(identity: RequestIdentity, periodId?: string, today: Date = new Date()): Promise<CloseChecklist> {
    const orgId = identity.activeOrganizationId;
    const db = this.repo.db();
    const all = await this.repo.periods(db, orgId);
    if (all.length === 0) throw new NotFoundException({ errorCode: 'NO_PERIODS', message: 'There is no accounting period yet. Create the fiscal year first.' });

    // Default: the earliest period that is not closed and has ended (the month to close now);
    // else the current one.
    const unclosed = all.filter((p) => p.status !== 'CLOSED');
    const period = periodId
      ? all.find((p) => p.id === periodId)
      : [...unclosed].reverse().find((p) => p.endDate < today) ?? unclosed.find((p) => p.startDate <= today && p.endDate >= today) ?? all[0];
    if (!period) throw new NotFoundException({ errorCode: 'PERIOD_NOT_FOUND', message: 'Accounting period not found' });

    const [unposted, journals, banks, tieOut, vat, requireBanks] = await Promise.all([
      this.repo.unposted(db, orgId, period.startDate, period.endDate),
      this.periods.countPendingJournals(db, orgId, period),
      this.periods.bankReconciliationStatus(db, orgId, period.endDate),
      this.periods.controlTieOut(orgId),
      this.vat.report(identity, day(period.startDate), day(period.endDate)),
      this.repo.requireBankReconciliation(db, orgId),
    ]);

    const queue = (key: string, label: string, count: number, href: string) => ({
      key, label, count, href, status: (count > 0 ? 'TODO' : 'DONE') as CloseCheckStatus,
      detail: count > 0 ? `${count} not posted` : 'All posted',
    });
    const documentItems = [
      queue('invoices', 'Client invoices', unposted.invoices, `${BASE}/invoices`),
      queue('receipts', 'Customer receipts', unposted.receipts, '/receipts'),
      queue('bills', 'Supplier bills', unposted.bills, `${BASE}/bills`),
      queue('payments', 'Supplier payments', unposted.payments, `${BASE}/payments`),
      queue('journals', 'Manual journals', journals, `${BASE}/journals`),
    ];
    const pendingDocs = documentItems.reduce((n, i) => n + i.count, 0);

    const bankItems = banks.map((b) => ({
      key: b.bankAccountId,
      label: b.label,
      status: (b.reconciled ? 'DONE' : 'TODO') as CloseCheckStatus,
      detail: b.reconciledTo ? `Reconciled to ${day(b.reconciledTo)}` : 'Never reconciled',
      href: `${BASE}/bank-reconciliation`,
    }));
    const banksDone = bankItems.every((b) => b.status === 'DONE');

    const tieOutItems = [
      { key: 'ar', label: 'Accounts receivable', status: (tieOut.ar.passed ? 'DONE' : 'BLOCKED') as CloseCheckStatus, detail: tieOut.ar.passed ? 'Ledger agrees with open invoices' : tieOut.ar.message, href: `${BASE}/reconciliation` },
      { key: 'ap', label: 'Accounts payable', status: (tieOut.ap.passed ? 'DONE' : 'BLOCKED') as CloseCheckStatus, detail: tieOut.ap.passed ? 'Ledger agrees with open bills' : tieOut.ap.message, href: `${BASE}/reconciliation` },
    ];
    const tieOutDone = tieOut.ar.passed && tieOut.ap.passed;

    const open = period.status === 'OPEN' || period.status === 'REOPENED';
    const closeBlocked = pendingDocs > 0 || journals > 0 || !tieOutDone || (requireBanks && !banksDone);

    const checks: CloseCheck[] = [
      {
        key: 'documents',
        status: pendingDocs === 0 ? 'DONE' : 'TODO',
        detail: pendingDocs === 0 ? `Everything dated in ${period.name} is posted.` : `${pendingDocs} document(s) dated in ${period.name} are not posted.`,
        href: null,
        items: documentItems,
      },
      {
        key: 'banks',
        status: bankItems.length === 0 ? 'INFO' : banksDone ? 'DONE' : requireBanks ? 'BLOCKED' : 'TODO',
        detail: bankItems.length === 0
          ? 'No bank account is set up for reconciliation.'
          : banksDone ? `Every bank account is reconciled to ${day(period.endDate)}.`
          : `Reconcile each bank account to a statement reaching ${day(period.endDate)}${requireBanks ? ' — required before closing.' : '.'}`,
        href: `${BASE}/bank-reconciliation`,
        items: bankItems,
      },
      {
        key: 'tie-out',
        status: tieOutDone ? 'DONE' : 'BLOCKED',
        detail: tieOutDone ? 'The AR and AP control accounts agree with their subledgers.' : 'A control account does not agree with its subledger; find the difference before closing.',
        href: `${BASE}/reconciliation`,
        items: tieOutItems,
      },
      {
        key: 'vat',
        status: 'INFO',
        detail: `Output VAT for ${period.name}: ${vat.output.total} (${vat.output.lines.length} posting(s)). The VAT account stands at ${vat.closingBalance}.`,
        href: `${BASE}/vat-report`,
        items: [],
      },
      {
        key: 'lock',
        status: open ? (pendingDocs > 0 || journals > 0 ? 'BLOCKED' : 'TODO') : 'DONE',
        detail: open ? 'Locking stops ordinary postings; only closing adjustments remain.' : 'The period is locked.',
        href: `${BASE}/periods`,
        items: [],
      },
      {
        key: 'close',
        status: period.status === 'CLOSED' ? 'DONE' : closeBlocked ? 'BLOCKED' : 'TODO',
        detail: period.status === 'CLOSED' ? 'The period is closed and snapshotted.' : closeBlocked ? 'Finish the checks above first.' : 'Ready: lock the period, then close it.',
        href: `${BASE}/periods`,
        items: [],
      },
    ];

    return {
      period: { id: period.id, name: period.name, startDate: day(period.startDate), endDate: day(period.endDate), status: period.status },
      periods: unclosed.map((p) => ({ id: p.id, name: p.name, status: p.status })),
      checks,
      requireBankReconciliation: requireBanks,
      readyToClose: period.status !== 'CLOSED' && !closeBlocked,
    };
  }

  /** Whether closing a month waits for every bank account to be reconciled. Audited. */
  async setRequireBankReconciliation(identity: RequestIdentity, value: boolean): Promise<{ requireBankReconciliation: boolean }> {
    const db = this.repo.db();
    await db.$transaction(async (tx) => {
      await this.repo.setRequireBankReconciliation(tx as never, identity.activeOrganizationId, value, identity.userId);
      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'BankingPolicy',
        resourceId: identity.activeOrganizationId,
        sourceCommand: 'close-checklist.require-bank-reconciliation',
        eventType: 'BANKING_POLICY_UPDATED',
        idempotencyKey: `banking-policy-${identity.activeOrganizationId}-${Date.now()}`,
        after: { requireBankReviewBeforeClose: value },
      });
    });
    return { requireBankReconciliation: value };
  }
}
