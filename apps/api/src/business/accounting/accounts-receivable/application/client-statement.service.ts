import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { ClientStatement, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ageOpenItems, buildStatementLines, type StatementMovement } from '../domain/client-statement.js';
import { ClientStatementRepository } from '../infrastructure/client-statement.repository.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * AR-3 — a client's statement of account for a period: every invoice, credit note and receipt
 * (and each one's reversal) across all projects and hand-typed sales, with the opening balance,
 * a running balance and the closing balance. Cash held on account counts against what is owed,
 * so the closing balance today equals open invoice balances less cash on account.
 */
@Injectable()
export class ClientStatementService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: ClientStatementRepository,
  ) {}

  async statement(identity: RequestIdentity, clientId: string, fromIso?: string, toIso?: string): Promise<ClientStatement> {
    const prisma = this.tenancyService.getClient() as unknown as PrismaClient;
    const orgId = identity.activeOrganizationId;
    const today = new Date().toISOString().slice(0, 10);
    const to = toIso ?? today;
    // Default: the start of the year `to` falls in.
    const from = fromIso ?? `${to.slice(0, 4)}-01-01`;
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
      throw new BadRequestException({ errorCode: 'STATEMENT_PERIOD_INVALID', message: 'Give a period as from ≤ to, both YYYY-MM-DD.' });
    }

    const client = await this.repo.findClient(prisma, orgId, clientId);
    if (!client) throw new NotFoundException({ errorCode: 'CLIENT_NOT_FOUND', message: `Client ${clientId} not found` });

    const [invoices, creditNotes, receipts] = await Promise.all([
      this.repo.findInvoices(prisma, orgId, clientId),
      this.repo.findCreditNotes(prisma, orgId, clientId),
      this.repo.findReceipts(prisma, orgId, clientId),
    ]);
    const reversalJournalIds = [
      ...invoices.map((i) => i.reversalJournalEntryId),
      ...creditNotes.map((c) => c.reversalJournalEntryId),
      ...receipts.map((r) => r.reversalJournalEntryId),
    ].filter((id): id is string => Boolean(id));
    const [journalDates, legacyReceiptReversals, projectNames] = await Promise.all([
      this.repo.journalDates(prisma, reversalJournalIds),
      this.repo.receiptReversalDates(
        prisma,
        orgId,
        receipts.filter((r) => r.postingStatus === 'REVERSED' && !r.reversalJournalEntryId).map((r) => r.id),
      ),
      this.repo.projectNames(prisma, orgId, [...new Set(invoices.map((i) => i.projectId).filter((id): id is string => Boolean(id)))]),
    ]);
    const reversalDate = (journalId: string | null, fallback: Date | null) =>
      (journalId ? journalDates.get(journalId) : undefined) ?? fallback ?? null;

    const zero = new Decimal(0);
    const movements: StatementMovement[] = [];
    for (const inv of invoices) {
      const amount = new Decimal(inv.totalAmount.toString());
      const description = inv.projectId ? (projectNames.get(inv.projectId) ?? null) : null;
      movements.push({
        date: inv.invoiceDate,
        kind: 'INVOICE',
        documentId: inv.id,
        reference: inv.invoiceNumber,
        description,
        debit: amount,
        credit: zero,
        sequence: 0,
      });
      if (inv.postingStatus === 'REVERSED') {
        const date = reversalDate(inv.reversalJournalEntryId, inv.reversedAt);
        if (date) movements.push({ date, kind: 'INVOICE_REVERSAL', documentId: inv.id, reference: inv.invoiceNumber, description, debit: zero, credit: amount, sequence: 1 });
      }
    }
    for (const cn of creditNotes) {
      const amount = new Decimal(cn.totalAmount.toString());
      const description = cn.invoice.invoiceNumber;
      movements.push({ date: cn.accountingDate, kind: 'CREDIT_NOTE', documentId: cn.invoiceId, reference: cn.creditNoteNumber, description, debit: zero, credit: amount, sequence: 2 });
      if (cn.postingStatus === 'REVERSED') {
        const date = reversalDate(cn.reversalJournalEntryId, cn.reversedAt);
        if (date) movements.push({ date, kind: 'CREDIT_NOTE_REVERSAL', documentId: cn.invoiceId, reference: cn.creditNoteNumber, description, debit: amount, credit: zero, sequence: 3 });
      }
    }
    for (const r of receipts) {
      const amount = new Decimal(r.totalAmount.toString());
      movements.push({ date: r.accountingDate, kind: 'RECEIPT', documentId: r.id, reference: r.receiptNumber, description: r.reference, debit: zero, credit: amount, sequence: 4 });
      if (r.postingStatus === 'REVERSED') {
        const date = reversalDate(r.reversalJournalEntryId, null) ?? legacyReceiptReversals.get(r.id) ?? r.reversedAt;
        if (date) movements.push({ date, kind: 'RECEIPT_REVERSAL', documentId: r.id, reference: r.receiptNumber, description: r.reference, debit: amount, credit: zero, sequence: 5 });
      }
    }

    const placed = buildStatementLines(movements, new Date(`${from}T00:00:00.000Z`), new Date(`${to}T00:00:00.000Z`));
    const openInvoices = invoices.filter((i) => i.postingStatus !== 'REVERSED' && i.documentStatus !== 'CANCELLED');
    const onAccount = receipts
      .filter((r) => r.postingStatus !== 'REVERSED')
      .reduce((sum, r) => sum.plus(r.unallocatedAmount.toString()), new Decimal(0));

    return {
      client: { id: client.id, name: client.name, code: client.code ?? null },
      from,
      to,
      openingBalance: placed.opening.toFixed(2),
      lines: placed.lines,
      totals: { debits: placed.debits.toFixed(2), credits: placed.credits.toFixed(2) },
      closingBalance: placed.closing.toFixed(2),
      aging: ageOpenItems(
        openInvoices.map((i) => ({ dueDate: i.dueDate, outstanding: new Decimal(i.outstandingAmount.toString()) })),
        new Date(`${today}T00:00:00.000Z`),
      ),
      onAccount: onAccount.toFixed(2),
    };
  }
}
