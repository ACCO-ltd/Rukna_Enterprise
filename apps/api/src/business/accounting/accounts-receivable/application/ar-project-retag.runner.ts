import type { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import type {
  IAccountingPostingPort,
  PostingCommand,
  TxClient,
} from '../../accounting-core/application/ports/accounting-posting.port.js';
import {
  RETAG_EVENT,
  RETAG_SOURCE_TYPE,
  correctionDescription,
  correctionLines,
  expectedProjectDeltas,
  proveRetag,
  retagFingerprint,
  retagSourceId,
  retagStatus,
  type RetagLine,
} from '../domain/ar-project-retag.policy.js';

/**
 * AR project-tag reclassification — the database side of `ar-project-retag.policy.ts`, used by
 * `scripts/ar-project-retag.ts` and by its DB test (so the test exercises the code that runs).
 * The audit and the measurements are read-only; only `applyRetag` writes, and only the approved
 * lines, in one transaction guarded by the proofs.
 */

export type Tx = Prisma.TransactionClient | PrismaClient;

interface Row {
  line_id: string;
  line_number: number;
  journal_entry_id: string;
  journal_number: string | null;
  accounting_date: Date;
  period_id: string | null;
  period_name: string | null;
  period_status: string | null;
  account_id: string;
  account_code: string;
  account_name: string;
  debit: string;
  credit: string;
  client_id: string | null;
  contract_id: string | null;
  source_kind: 'INVOICE_REVERSAL' | 'CREDIT_NOTE';
  invoice_id: string;
  invoice_number: string | null;
  credit_note_id: string | null;
  credit_note_number: string | null;
  intended_project_id: string;
  intended_project_code: string | null;
  already_corrected: boolean;
  prior_corrections: number;
}

/** Revenue = the account's latest version is INCOME — the same test `sumPostedRevenue` uses. */
const INCOME_ACCOUNT = `(
  SELECT av.account_class FROM account_versions av
  WHERE av.account_id = l.account_id ORDER BY av.effective_from DESC LIMIT 1
) = 'INCOME'`;

/** A posted correction journal for the audited line `a` (base key or a versioned re-correction). */
const CORRECTION_OF_LINE = `c.organization_id = $1 AND c.source_document_type = '${RETAG_SOURCE_TYPE}'
  AND c.status = 'POSTED'
  AND (c.source_document_id = 'ar-project-retag:' || a.line_id
       OR c.source_document_id LIKE 'ar-project-retag:' || a.line_id || ':v%')`;
/** …that has itself been reversed (e.g. from Manual Journals) — it no longer corrects anything. */
const IS_REVERSED = `EXISTS (SELECT 1 FROM journal_entries r
  WHERE r.reversal_of_journal_entry_id = c.id AND r.status = 'POSTED')`;

/** Every untagged reversal / credit-note revenue line, with what it should have carried. Read-only. */
export async function auditRetag(prisma: Tx, orgId: string): Promise<RetagLine[]> {
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `
    WITH affected AS (
      -- Invoice reversals: the reversing line mirrors an original line — same account, debit and
      -- credit swapped — whose project it should have carried. Matched on the mirror, not on line
      -- order (reverse() does not guarantee order); one match per line, preferring the same number.
      (SELECT DISTINCT ON (l.id) l.id AS line_id, l.line_number, e.id AS journal_entry_id, e.journal_number,
             e.accounting_date, e.accounting_period_id AS period_id, l.account_id,
             l.account_code_snapshot AS account_code, l.account_name_snapshot AS account_name,
             l.debit_amount::text AS debit, l.credit_amount::text AS credit, l.client_id, l.contract_id,
             'INVOICE_REVERSAL' AS source_kind, ci.id AS invoice_id, ci.invoice_number,
             NULL::text AS credit_note_id, NULL::text AS credit_note_number,
             ol.project_id AS intended_project_id
      FROM journal_entries e
      JOIN journal_lines l ON l.journal_entry_id = e.id
      JOIN journal_lines ol ON ol.journal_entry_id = e.reversal_of_journal_entry_id
                           AND ol.account_id = l.account_id
                           AND ol.debit_amount = l.credit_amount AND ol.credit_amount = l.debit_amount
      JOIN client_invoices ci ON ci.posted_journal_entry_id = e.reversal_of_journal_entry_id
      WHERE e.organization_id = $1 AND e.status = 'POSTED'
        AND e.source_document_type = 'CLIENT_INVOICE' AND e.accounting_event_id = 'EVT-AR-002'
        AND l.project_id IS NULL AND ol.project_id IS NOT NULL AND ${INCOME_ACCOUNT}
      ORDER BY l.id, (ol.line_number = l.line_number) DESC)
      UNION ALL
      -- Credit notes: the revenue debit should carry the credited invoice's project.
      SELECT l.id, l.line_number, e.id, e.journal_number, e.accounting_date, e.accounting_period_id,
             l.account_id, l.account_code_snapshot, l.account_name_snapshot,
             l.debit_amount::text, l.credit_amount::text, l.client_id, l.contract_id,
             'CREDIT_NOTE', ci.id, ci.invoice_number, cn.id, cn.credit_note_number, ci.project_id
      FROM journal_entries e
      JOIN journal_lines l ON l.journal_entry_id = e.id
      JOIN credit_notes cn ON cn.id = e.source_document_id
      JOIN client_invoices ci ON ci.id = cn.invoice_id
      WHERE e.organization_id = $1 AND e.status = 'POSTED'
        AND e.source_document_type = 'CREDIT_NOTE' AND e.accounting_event_id = 'EVT-AR-007'
        AND l.project_id IS NULL AND ci.project_id IS NOT NULL AND ${INCOME_ACCOUNT}
    )
    SELECT a.*, ap.name AS period_name, ap.status::text AS period_status,
           p.code AS intended_project_code,
           EXISTS (
             SELECT 1 FROM journal_entries c
             WHERE ${CORRECTION_OF_LINE} AND NOT ${IS_REVERSED}
           ) AS already_corrected,
           (SELECT COUNT(*) FROM journal_entries c
            WHERE ${CORRECTION_OF_LINE} AND ${IS_REVERSED})::int AS prior_corrections
    FROM affected a
    LEFT JOIN accounting_periods ap ON ap.id = a.period_id
    LEFT JOIN projects p ON p.id = a.intended_project_id
    ORDER BY a.accounting_date, a.journal_number, a.line_number
    `,
    orgId,
  );
  return rows.map((r) => ({
    lineId: r.line_id,
    lineNumber: Number(r.line_number),
    journalEntryId: r.journal_entry_id,
    journalNumber: r.journal_number,
    accountingDate: r.accounting_date.toISOString().slice(0, 10),
    periodId: r.period_id,
    periodName: r.period_name,
    periodStatus: r.period_status,
    accountId: r.account_id,
    accountCode: r.account_code,
    accountName: r.account_name,
    debit: r.debit,
    credit: r.credit,
    clientId: r.client_id,
    contractId: r.contract_id,
    sourceKind: r.source_kind,
    sourceInvoiceId: r.invoice_id,
    sourceInvoiceNumber: r.invoice_number,
    creditNoteId: r.credit_note_id,
    creditNoteNumber: r.credit_note_number,
    intendedProjectId: r.intended_project_id,
    intendedProjectCode: r.intended_project_code,
    alreadyCorrected: r.already_corrected,
    priorCorrections: Number(r.prior_corrections),
  }));
}

/** Net (debit − credit) of every account over all posted lines — the trial balance, per account. */
export async function accountNets(prisma: Tx, orgId: string): Promise<Map<string, Decimal>> {
  const rows = await prisma.$queryRawUnsafe<{ account_id: string; net: string }[]>(
    `SELECT l.account_id, (SUM(l.debit_amount) - SUM(l.credit_amount))::text AS net
     FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
     WHERE e.organization_id = $1 AND e.status = 'POSTED'
     GROUP BY l.account_id`,
    orgId,
  );
  return new Map(rows.map((r) => [r.account_id, new Decimal(r.net)]));
}

/** Credit-normal revenue per project ('' = no project), excluding CLOSING entries. */
export async function revenueByProject(prisma: Tx, orgId: string): Promise<Map<string, Decimal>> {
  const rows = await prisma.$queryRawUnsafe<{ project_id: string | null; revenue: string }[]>(
    `SELECT l.project_id, (SUM(l.credit_amount) - SUM(l.debit_amount))::text AS revenue
     FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
     WHERE e.organization_id = $1 AND e.status = 'POSTED'
       AND e.entry_purpose <> 'CLOSING' AND ${INCOME_ACCOUNT}
     GROUP BY l.project_id`,
    orgId,
  );
  return new Map(rows.map((r) => [r.project_id ?? '', new Decimal(r.revenue)]));
}

/**
 * The Finance "Billing and general ledger" check for one project: what was billed (posted
 * invoice subtotals less posted credit notes, excluding tax) minus the revenue posted. 0 = clears.
 */
export async function billingGap(prisma: Tx, orgId: string, projectId: string): Promise<Decimal> {
  const [row] = await prisma.$queryRawUnsafe<{ billed: string }[]>(
    `SELECT (
       COALESCE((SELECT SUM(subtotal) FROM client_invoices
                 WHERE organization_id = $1 AND project_id = $2 AND posting_status = 'POSTED'), 0)
       - COALESCE((SELECT SUM(cn.total_amount - cn.vat_amount) FROM credit_notes cn
                   JOIN client_invoices ci ON ci.id = cn.invoice_id
                   WHERE cn.organization_id = $1 AND cn.posting_status = 'POSTED' AND ci.project_id = $2), 0)
     )::text AS billed`,
    orgId,
    projectId,
  );
  const revenue = (await revenueByProject(prisma, orgId)).get(projectId) ?? new Decimal(0);
  return new Decimal(row?.billed ?? '0').minus(revenue);
}

export interface ApprovedRetagReport {
  organizationId: string;
  fingerprint: string;
  ready: RetagLine[];
}

export interface RetagGap {
  projectId: string;
  before: Decimal;
  after: Decimal;
  /** The gap is fully explained by the corrected lines (after = 0). */
  cleared: boolean;
}

export interface RetagApplySummary {
  posted: string[];
  stale: string[];
  gaps: RetagGap[];
}

/**
 * The accountant's approval is enforced, not assumed: the approver must be an active user of this
 * organization who holds `manage:journal` (create, approve, post and reverse journals), and must
 * not be the person running the apply — the same separation of duties manual journals follow.
 */
export async function assertApprover(prisma: Tx, orgId: string, approvedBy: string, actor: string): Promise<void> {
  if (approvedBy === actor) {
    throw new Error('The approver must be someone other than the person applying the corrections.');
  }
  const approver = await prisma.user.findFirst({
    where: {
      id: approvedBy,
      organizationId: orgId,
      status: 'ACTIVE',
      userRoles: {
        some: { role: { rolePermissions: { some: { permission: { action: 'manage', resource: 'journal' } } } } },
      },
    },
    select: { id: true },
  });
  if (!approver) {
    throw new Error(
      `Approver ${approvedBy} is not an active user of this organization with journal approval rights (manage:journal).`,
    );
  }
}

/**
 * Posts exactly the approved corrections. Re-audits first and refuses — posting nothing — if the
 * ledger no longer matches the approved report. All corrections, the proofs and the snapshot
 * invalidation commit together or not at all.
 */
export async function applyRetag(
  prisma: PrismaClient,
  posting: IAccountingPostingPort,
  input: { orgId: string; approved: ApprovedRetagReport; approvedBy: string; actor: string },
): Promise<RetagApplySummary> {
  const { orgId, approved } = input;
  if (approved.organizationId !== orgId) throw new Error('Approved report is for a different organization.');
  if (approved.ready.length === 0) return { posted: [], stale: [], gaps: [] };
  await assertApprover(prisma, orgId, input.approvedBy, input.actor);

  const lines = await auditRetag(prisma, orgId);
  const ready = lines.filter((l) => retagStatus(l) === 'READY');
  const approvedIds = new Set(approved.ready.map((l) => l.lineId));
  const toPost = ready.filter((l) => approvedIds.has(l.lineId));
  if (retagFingerprint(toPost) !== approved.fingerprint || toPost.length !== approved.ready.length) {
    throw new Error(
      'The ledger no longer matches the approved report (a line was corrected, changed, or its period ' +
        'closed since). Re-run the audit and have the new report approved. Nothing was posted.',
    );
  }

  const deltas = expectedProjectDeltas(toPost);

  const result = await prisma.$transaction(
    async (tx) => {
      const accountNetBefore = await accountNets(tx, orgId);
      const projectRevenueBefore = await revenueByProject(tx, orgId);
      const gapBefore = new Map<string, Decimal>();
      for (const project of deltas.keys()) gapBefore.set(project, await billingGap(tx, orgId, project));

      const posted: string[] = [];
      for (const line of toPost) {
        const accountingDate = new Date(`${line.accountingDate}T00:00:00.000Z`);
        const command: PostingCommand = {
          organizationId: orgId,
          accountingDate,
          documentDate: accountingDate,
          description: correctionDescription(line, input.approvedBy),
          currencyCode: 'USD', // single-currency (ADR-024)
          eventType: RETAG_EVENT,
          sourceDocumentType: RETAG_SOURCE_TYPE,
          sourceDocumentId: retagSourceId(line.lineId, line.priorCorrections),
          journalCategory: 'GENERAL',
          entryPurpose: 'NORMAL',
          postingOrigin: 'MANUAL',
          createdBy: input.actor,
          approvedBy: input.approvedBy,
          lines: correctionLines(line).map((c) => ({
            accountId: c.accountId,
            debitAmount: c.debitAmount,
            creditAmount: c.creditAmount,
            projectId: c.projectId ?? undefined,
            clientId: c.clientId ?? undefined,
            contractId: c.contractId ?? undefined,
            memo: c.memo,
          })),
        };
        const res = await posting.post(command, tx as unknown as TxClient);
        posted.push(`${line.journalNumber ?? line.journalEntryId}/${line.lineNumber} → ${res.journalNumber}`);
        await tx.auditLog.create({
          data: {
            userId: input.actor,
            orgId,
            action: 'AR_PROJECT_RETAG_POSTED',
            resource: 'journal',
            resourceId: res.journalEntryId,
            reason: command.description,
            sourceCommand: 'scripts/ar-project-retag.ts',
            correlationId: approved.fingerprint,
            after: {
              correctsJournalLineId: line.lineId,
              correctsJournalEntryId: line.journalEntryId,
              sourceInvoiceId: line.sourceInvoiceId,
              creditNoteId: line.creditNoteId,
              intendedProjectId: line.intendedProjectId,
              debit: line.debit,
              credit: line.credit,
              approvedBy: input.approvedBy,
            },
          },
        });
      }

      const proof = proveRetag({
        accountNetBefore,
        accountNetAfter: await accountNets(tx, orgId),
        projectRevenueBefore,
        projectRevenueAfter: await revenueByProject(tx, orgId),
        expectedDeltas: deltas,
      });
      // Billing–GL: each affected project's gap (billed − revenue) must move by exactly the
      // corrected amount. What remains afterwards is not caused by missing tags and is reported.
      const gaps: RetagGap[] = [];
      for (const [project, delta] of deltas) {
        const before = gapBefore.get(project)!;
        const after = await billingGap(tx, orgId, project);
        if (!after.equals(before.minus(delta))) {
          proof.failures.push(`Billing–GL gap for ${project} moved ${after.minus(before)}, expected ${delta.negated()}`);
        }
        gaps.push({ projectId: project, before, after, cleared: after.isZero() });
      }
      if (proof.failures.length > 0) {
        throw new Error(`Proof failed — rolling back, nothing posted:\n  ${proof.failures.join('\n  ')}`);
      }

      // A period snapshot covering these periods (or later ones in the year) is now stale: mark it
      // INVALID so no report trusts it, and name the periods that need an authorised rebuild.
      const periodIds = [...new Set(toPost.map((l) => l.periodId).filter((id): id is string => Boolean(id)))];
      const periods = await tx.accountingPeriod.findMany({
        where: { id: { in: periodIds } },
        select: { fiscalYearId: true, periodNumber: true },
      });
      const stale: string[] = [];
      for (const period of periods) {
        const affected = await tx.accountingPeriod.findMany({
          where: { organizationId: orgId, fiscalYearId: period.fiscalYearId, periodNumber: { gte: period.periodNumber } },
          select: { id: true, name: true },
        });
        const res = await tx.periodAccountBalance.updateMany({
          where: { organizationId: orgId, accountingPeriodId: { in: affected.map((p) => p.id) }, status: 'VALID' },
          data: { status: 'INVALID' },
        });
        if (res.count > 0) stale.push(...affected.map((p) => p.name));
      }
      return { posted, stale: [...new Set(stale)], gaps };
    },
    { timeout: 120_000 },
  );
  return result;
}
