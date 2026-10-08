/**
 * ADR-045 test fixture: the quotation fixture (org, personas, project, supplier, AP account, an
 * expense profile) plus what paying from an award needs — the chart's bank / cash / mobile-money,
 * supplier-advance and staff-advance accounts, open periods for 2026, the STAFF_ADVANCE profile,
 * a cash box and an EVC float without signatories, and a main bank under dual control. DB-backed;
 * call `cleanupPaymentEnv` in afterAll.
 */
import type { PrismaClient } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import {
  cleanupQuotationEnv,
  createQuotationEnv,
  type QuotationTestEnv,
} from '../../../../procurement/quotations/__tests__/helpers/quotation-fixture.js';

export interface PaymentTestEnv extends QuotationTestEnv {
  accounts: {
    apId: string;
    apCode: string;
    expenseId: string;
    bankGlId: string;
    cashGlId: string;
    evcGlId: string;
    supplierAdvanceId: string;
    staffAdvanceId: string;
  };
  bank: { cashBoxId: string; evcId: string; mainBankId: string };
  /** A second Finance Officer (manage:payable) — pays when the first approved the bill. */
  payer2: RequestIdentity;
  /** The site storekeeper who posts goods receipts (not the PO creator). */
  receiver: RequestIdentity;
}

export async function createPaymentEnv(prisma: PrismaClient): Promise<PaymentTestEnv> {
  const env = await createQuotationEnv(prisma);
  const orgId = env.orgId;
  const by = env.identity.userId;

  const mkAccount = async (code: string, nb: 'DEBIT' | 'CREDIT', cls: string, sub: string, name: string) => {
    const acct = await prisma.account.create({
      data: { id: `${orgId}-${code}`, organizationId: orgId, code, normalBalance: nb, createdBy: by },
    });
    await prisma.accountVersion.create({
      data: {
        accountId: acct.id,
        versionNumber: 1,
        name,
        accountClass: cls as never,
        accountSubtype: sub as never,
        isPostingAllowed: true,
        isControlAccount: false,
        controlPostingPolicy: 'UNRESTRICTED',
        effectiveFrom: new Date('2025-01-01'),
        changedBy: by,
      },
    });
    return acct.id;
  };
  const bankGlId = await mkAccount('10100', 'DEBIT', 'ASSET', 'CASH_AND_BANK', 'Salaam Bank');
  const cashGlId = await mkAccount('10900', 'DEBIT', 'ASSET', 'CASH_AND_BANK', 'Petty cash');
  const evcGlId = await mkAccount('10950', 'DEBIT', 'ASSET', 'CASH_AND_BANK', 'EVC Plus float');
  const supplierAdvanceId = await mkAccount('13000', 'DEBIT', 'ASSET', 'SUPPLIER_ADVANCE', 'Advances to suppliers');
  const staffAdvanceId = await mkAccount('13100', 'DEBIT', 'ASSET', 'OTHER_CURRENT_ASSET', 'Staff advances');

  // Every 2026 month open (the base fixture opened August only).
  for (let m = 1; m <= 12; m++) {
    if (m === 8) continue;
    const start = new Date(Date.UTC(2026, m - 1, 1));
    const end = new Date(Date.UTC(2026, m, 0));
    await prisma.accountingPeriod.create({
      data: {
        organizationId: orgId,
        fiscalYearId: env.fiscalYearId,
        periodNumber: m,
        name: `${start.toISOString().slice(0, 7)}`,
        startDate: start,
        endDate: end,
        status: 'OPEN',
      },
    });
  }

  const profile = await prisma.postingProfile.create({
    data: { organizationId: orgId, code: 'STAFF_ADVANCE', status: 'ACTIVE', createdBy: by },
  });
  await prisma.postingProfileVersion.create({
    data: {
      postingProfileId: profile.id,
      versionNumber: 1,
      name: 'Staff advances',
      accountId: staffAdvanceId,
      effectiveFrom: new Date('2026-01-01'),
      changedBy: by,
    },
  });

  const mkBank = (glAccountId: string, bankName: string, accountNumber: string) =>
    prisma.bankAccount.create({
      data: {
        organizationId: orgId,
        glAccountId,
        bankName,
        accountName: bankName,
        accountNumber: `${accountNumber}-${orgId.slice(-6)}`,
        currencyCode: 'USD',
        createdBy: by,
      },
    });
  const cashBox = await mkBank(cashGlId, 'Cash box', 'CASH');
  const evc = await mkBank(evcGlId, 'EVC Plus', 'EVC');
  const mainBank = await mkBank(bankGlId, 'Salaam Bank', 'SB-001');
  for (const persona of ['cfo', 'director'] as const) {
    await prisma.bankAccountSignatory.create({
      data: { organizationId: orgId, bankAccountId: mainBank.id, userId: env.userIds[persona], addedBy: by },
    });
  }

  // A second Finance Officer and a storekeeper.
  const extraUser = async (suffix: string) => {
    const id = `${orgId}-${suffix}`;
    await prisma.user.create({
      data: { id, organizationId: orgId, email: `${id}@example.test`, passwordHash: 'x', firstName: suffix, lastName: 'Tester', status: 'ACTIVE' },
    });
    await prisma.organizationMembership.create({ data: { organizationId: orgId, userId: id, status: 'ACTIVE' } });
    await prisma.projectMember.create({ data: { projectId: env.projectId, userId: id, joinedBy: id } });
    return id;
  };
  const payer2Id = await extraUser('payer2');
  const receiverId = await extraUser('receiver');
  const identity = (userId: string, roles: string[], permissions: string[]): RequestIdentity => ({
    userId,
    activeOrganizationId: orgId,
    tenantSlug: env.identity.tenantSlug,
    roles,
    permissions,
  });

  return {
    ...env,
    accounts: {
      apId: env.apAccountId,
      apCode: 'AP-PROC',
      expenseId: env.expAccountId,
      bankGlId,
      cashGlId,
      evcGlId,
      supplierAdvanceId,
      staffAdvanceId,
    },
    bank: { cashBoxId: cashBox.id, evcId: evc.id, mainBankId: mainBank.id },
    payer2: identity(payer2Id, ['Finance Officer'], [
      PERMISSIONS.procurementView,
      PERMISSIONS.payablesManage,
      PERMISSIONS.commitmentsView,
      PERMISSIONS.quotationsAward,
    ]),
    receiver: identity(receiverId, ['Site Engineer'], ['*']),
  };
}

export async function cleanupPaymentEnv(prisma: PrismaClient, env: PaymentTestEnv): Promise<void> {
  const orgId = env.orgId;
  await prisma.$executeRaw`DELETE FROM store_document_photos WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM store_documents WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM approval_actions WHERE instance_id IN (SELECT id FROM approval_instances WHERE workflow_definition_id IN (SELECT id FROM workflow_definitions WHERE organization_id = ${orgId}))`;
  await cleanupQuotationEnv(prisma, env);
}

/** Σ debit − credit per account code over posted journals of the org (a trial balance slice). */
export async function balances(prisma: PrismaClient, orgId: string): Promise<Record<string, string>> {
  const rows = await prisma.$queryRaw<Array<{ code: string; net: string }>>`
    SELECT a.code, SUM(l.debit_amount - l.credit_amount)::text AS net
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id
    JOIN accounts a ON a.id = l.account_id
    WHERE e.organization_id = ${orgId}
    GROUP BY a.code`;
  return Object.fromEntries(rows.map((r) => [r.code, Number(r.net).toFixed(2)]));
}

/** The lines of a journal as [accountCode, debit, credit] (2 dp), in line order. */
export async function journalLines(prisma: PrismaClient, journalEntryId: string) {
  const entry = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: journalEntryId },
    include: { lines: { orderBy: { lineNumber: 'asc' } } },
  });
  return {
    entry,
    lines: entry.lines.map((l) => [l.accountCodeSnapshot, Number(l.debitAmount).toFixed(2), Number(l.creditAmount).toFixed(2)]),
  };
}
