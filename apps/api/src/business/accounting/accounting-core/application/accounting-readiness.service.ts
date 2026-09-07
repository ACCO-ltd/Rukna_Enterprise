import { Injectable } from '@nestjs/common';
import type { AccountSubtype } from '@prisma/client';
import type { AccountingReadinessResponse, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';

/**
 * Can this organisation post to the general ledger, and if not, exactly what is missing?
 *
 * Every accounting-dependent figure in the Finance workspace is either a real number or
 * genuinely unavailable, and the difference matters: a project with no posted cost because
 * the chart of accounts was never finished has not spent $0. Today that state surfaces as a
 * generic load failure or, worse, as a confident-looking zero.
 *
 * Only what the code actually dereferences at post time is checked. The posting-rule tables
 * (`PostingRuleVersion`, `PostingRuleLineTemplate`) are deliberately absent: they have zero
 * references anywhere in the codebase, and putting unused scaffolding on a setup checklist
 * sends someone off to configure a thing that does nothing.
 */
@Injectable()
export class AccountingReadinessService {
  constructor(private readonly tenancy: TenancyService) {}

  async getReadiness(identity: RequestIdentity): Promise<AccountingReadinessResponse> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const today = new Date();

    const [accounts, openPeriods, futurePeriods, profiles, sequences] = await Promise.all([
      prisma.account.findMany({
        where: { organizationId: orgId, status: 'ACTIVE' },
        select: { id: true, versions: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
      }),
      prisma.accountingPeriod.count({
        where: {
          organizationId: orgId,
          status: { in: ['OPEN', 'REOPENED'] },
          startDate: { lte: today },
          endDate: { gte: today },
        },
      }),
      // A calendar that runs out is a silent trap: posting past its last period fails with
      // "no accounting period covers this date" rather than "open next year".
      prisma.accountingPeriod.count({
        where: { organizationId: orgId, endDate: { gte: today } },
      }),
      prisma.postingProfile.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
      prisma.documentNumberSequence.findMany({
        where: { organizationId: orgId, status: 'ACTIVE' },
        select: { documentType: true },
      }),
    ]);

    // A role is filled by exactly one active account. Zero means the chart is incomplete;
    // two means it is contradictory and posting must not guess — the same rule
    // `PostingAccountResolver` enforces, reported before someone presses Post rather than as
    // a 400 afterwards.
    const bySubtype = new Map<string, number>();
    for (const account of accounts) {
      const subtype = account.versions[0]?.accountSubtype;
      if (subtype) bySubtype.set(subtype, (bySubtype.get(subtype) ?? 0) + 1);
    }

    const REQUIRED_ROLES: Array<{ subtype: AccountSubtype; label: string }> = [
      { subtype: 'ACCOUNTS_RECEIVABLE' as AccountSubtype, label: 'Accounts receivable control' },
      { subtype: 'ACCOUNTS_PAYABLE' as AccountSubtype, label: 'Accounts payable control' },
      { subtype: 'PROJECT_REVENUE' as AccountSubtype, label: 'Project revenue' },
      { subtype: 'VAT_OUTPUT_PAYABLE' as AccountSubtype, label: 'Output VAT payable' },
      { subtype: 'CASH_AND_BANK' as AccountSubtype, label: 'Bank / cash' },
      { subtype: 'UNAPPLIED_CLIENT_RECEIPTS' as AccountSubtype, label: 'Unapplied client receipts' },
      { subtype: 'SUPPLIER_ADVANCE' as AccountSubtype, label: 'Supplier advance' },
    ];

    const blockers: AccountingReadinessResponse['blockers'] = [];

    if (accounts.length === 0) {
      blockers.push({
        code: 'NO_CHART_OF_ACCOUNTS',
        label: 'Chart of accounts',
        detail: 'No active accounts exist. Nothing can be posted until the chart is set up.',
      });
    } else {
      for (const role of REQUIRED_ROLES) {
        const count = bySubtype.get(role.subtype) ?? 0;
        // Bank is legitimately plural — an organisation with five banks has five accounts,
        // and the user picks. Every other role must resolve to exactly one.
        if (count === 0) {
          blockers.push({
            code: 'POSTING_ACCOUNT_NOT_CONFIGURED',
            label: role.label,
            detail: `No active account is marked ${role.subtype}.`,
          });
        } else if (count > 1 && role.subtype !== ('CASH_AND_BANK' as AccountSubtype)) {
          blockers.push({
            code: 'POSTING_ACCOUNT_AMBIGUOUS',
            label: role.label,
            detail: `${count} active accounts are marked ${role.subtype}. An administrator must resolve which is the control account.`,
          });
        }
      }
    }

    if (openPeriods === 0) {
      blockers.push({
        code: 'NO_OPEN_PERIOD',
        label: "Today's accounting period",
        detail:
          futurePeriods === 0
            ? 'The fiscal calendar does not reach today. Create the fiscal year before posting.'
            : 'No period covering today is OPEN or REOPENED.',
      });
    }

    if (profiles === 0) {
      blockers.push({
        code: 'NO_POSTING_PROFILES',
        label: 'Expense posting profiles',
        detail:
          'A supplier bill line resolves its expense account through a posting profile. None is configured.',
      });
    }

    const haveSequences = new Set(sequences.map((s) => s.documentType));
    for (const documentType of ['JOURNAL_ENTRY', 'CLIENT_INVOICE', 'SUPPLIER_BILL'] as const) {
      if (!haveSequences.has(documentType)) {
        blockers.push({
          code: 'NO_DOCUMENT_SEQUENCE',
          label: `${documentType.replace(/_/g, ' ').toLowerCase()} numbering`,
          detail: `No active document number sequence for ${documentType}.`,
        });
      }
    }

    return {
      ready: blockers.length === 0,
      blockers,
      checkedAt: new Date().toISOString(),
    };
  }
}
