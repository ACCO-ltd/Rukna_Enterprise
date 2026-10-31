import { Decimal } from '@prisma/client/runtime/library';

/**
 * ST-4 — where a client's account stands, contract by contract: what each contract is worth, how
 * much of it has been billed, what was paid, credited or written off, what is still owed (and how
 * much of that is overdue), the retention held back, and what is left to bill. Hand-typed sales
 * and invoices with no contract are grouped apart. Pure: the repository loads, this adds up.
 *
 * Every row ties: invoiced − received − credited − written off = balance due.
 */

export interface SummaryInvoice {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: Date;
  dueDate: Date | null;
  totalAmount: Decimal;
  outstandingAmount: Decimal;
  /** Work billed before tax (IPC: certified gross less other deductions). */
  subtotal: Decimal;
  retentionAmount: Decimal;
  retentionReleasedAmount: Decimal;
  projectId: string | null;
  contractId: string | null;
  sourceRetentionContractId: string | null;
  /** A separate charge: billed to the client, but not part of the contract value. */
  sourceBoqNodeId: string | null;
  /** What the invoice is for when it has no contract: the client's PO, else its first line. */
  label: string | null;
}

export interface SummaryContract {
  id: string;
  contractNumber: string;
  contractValue: Decimal;
  projectId: string;
  status: string;
}

export type AccountKind = 'CONTRACT' | 'PROJECT' | 'OTHER_SALES';

export interface AccountRow {
  key: string;
  kind: AccountKind;
  projectId: string | null;
  projectName: string | null;
  contractId: string | null;
  contractNumber: string | null;
  contractStatus: string | null;
  contractValue: string | null;
  /** Contract work billed so far, before tax; separate charges and retention releases excluded. */
  billedToDate: string | null;
  leftToBill: string | null;
  invoiced: string;
  received: string;
  credited: string;
  writtenOff: string;
  balanceDue: string;
  overdue: string;
  retentionHeld: string;
  invoiceCount: number;
}

export interface OpenInvoice {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  projectName: string | null;
  contractNumber: string | null;
  label: string | null;
  total: string;
  received: string;
  /** Credited and written off. */
  adjusted: string;
  balance: string;
  /** 0 when not yet due (or no due date). */
  daysOverdue: number;
}

const ZERO = new Decimal(0);
const DAY = 86_400_000;

/** The statuses whose contracts are shown even before anything is billed. */
const LIVE_CONTRACT = new Set(['ACTIVE', 'FINAL_ACCOUNT_PENDING', 'CLOSED', 'TERMINATED']);

export function summariseAccount(input: {
  invoices: readonly SummaryInvoice[];
  contracts: readonly SummaryContract[];
  projectNames: ReadonlyMap<string, string>;
  receivedByInvoice: ReadonlyMap<string, Decimal>;
  creditedByInvoice: ReadonlyMap<string, Decimal>;
  writtenOffByInvoice: ReadonlyMap<string, Decimal>;
  today: Date;
}): { accounts: AccountRow[]; openInvoices: OpenInvoice[]; retentionHeld: string; overdue: string } {
  const { invoices, projectNames, today } = input;
  const contractById = new Map(input.contracts.map((c) => [c.id, c]));
  const get = (map: ReadonlyMap<string, Decimal>, id: string) => map.get(id) ?? ZERO;
  const overdueDays = (due: Date | null) => (due ? Math.max(0, Math.floor((today.getTime() - due.getTime()) / DAY)) : 0);

  interface Acc {
    row: Omit<AccountRow, 'invoiced' | 'received' | 'credited' | 'writtenOff' | 'balanceDue' | 'overdue' | 'retentionHeld' | 'billedToDate' | 'leftToBill' | 'contractValue'>;
    contractValue: Decimal | null;
    billed: Decimal;
    invoiced: Decimal;
    received: Decimal;
    credited: Decimal;
    writtenOff: Decimal;
    balance: Decimal;
    overdue: Decimal;
    retainedIn: Decimal;
    retainedOut: Decimal;
  }
  const groups = new Map<string, Acc>();
  const open = (key: string, kind: AccountKind, projectId: string | null, contract: SummaryContract | null): Acc => {
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        row: {
          key,
          kind,
          projectId,
          projectName: projectId ? (projectNames.get(projectId) ?? null) : null,
          contractId: contract?.id ?? null,
          contractNumber: contract?.contractNumber ?? null,
          contractStatus: contract?.status ?? null,
          invoiceCount: 0,
        },
        contractValue: contract ? contract.contractValue : null,
        billed: ZERO,
        invoiced: ZERO,
        received: ZERO,
        credited: ZERO,
        writtenOff: ZERO,
        balance: ZERO,
        overdue: ZERO,
        retainedIn: ZERO,
        retainedOut: ZERO,
      };
      groups.set(key, acc);
    }
    return acc;
  };

  // Contracts appear even before their first invoice: all of their value is still to bill.
  for (const c of input.contracts) {
    if (LIVE_CONTRACT.has(c.status)) open(`contract:${c.id}`, 'CONTRACT', c.projectId, c);
  }

  const openInvoices: OpenInvoice[] = [];
  for (const inv of invoices) {
    const contract = contractById.get(inv.contractId ?? inv.sourceRetentionContractId ?? '') ?? null;
    const acc = contract
      ? open(`contract:${contract.id}`, 'CONTRACT', contract.projectId, contract)
      : inv.projectId
        ? open(`project:${inv.projectId}`, 'PROJECT', inv.projectId, null)
        : open('other', 'OTHER_SALES', null, null);
    const received = get(input.receivedByInvoice, inv.id);
    const credited = get(input.creditedByInvoice, inv.id);
    const writtenOff = get(input.writtenOffByInvoice, inv.id);
    const days = overdueDays(inv.dueDate);

    acc.row.invoiceCount += 1;
    acc.invoiced = acc.invoiced.plus(inv.totalAmount);
    acc.received = acc.received.plus(received);
    acc.credited = acc.credited.plus(credited);
    acc.writtenOff = acc.writtenOff.plus(writtenOff);
    acc.balance = acc.balance.plus(inv.outstandingAmount);
    if (days > 0) acc.overdue = acc.overdue.plus(inv.outstandingAmount);
    acc.retainedIn = acc.retainedIn.plus(inv.retentionAmount);
    acc.retainedOut = acc.retainedOut.plus(inv.retentionReleasedAmount);
    // Contract work billed: not a separate charge (outside the contract value), not a release
    // (it bills retention already counted in the certificate it was held from).
    if (contract && !inv.sourceBoqNodeId && !inv.sourceRetentionContractId) acc.billed = acc.billed.plus(inv.subtotal);

    if (inv.outstandingAmount.gt(0)) {
      openInvoices.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
        dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null,
        projectName: acc.row.projectName,
        contractNumber: acc.row.contractNumber,
        label: inv.label,
        total: inv.totalAmount.toFixed(2),
        received: received.toFixed(2),
        adjusted: credited.plus(writtenOff).toFixed(2),
        balance: inv.outstandingAmount.toFixed(2),
        daysOverdue: days,
      });
    }
  }

  const order: Record<AccountKind, number> = { CONTRACT: 0, PROJECT: 1, OTHER_SALES: 2 };
  const accounts = [...groups.values()]
    .sort((a, b) => order[a.row.kind] - order[b.row.kind] || (a.row.projectName ?? '').localeCompare(b.row.projectName ?? ''))
    .map((acc): AccountRow => {
      const held = Decimal.max(acc.retainedIn.minus(acc.retainedOut), ZERO);
      return {
        ...acc.row,
        contractValue: acc.contractValue?.toFixed(2) ?? null,
        billedToDate: acc.contractValue ? acc.billed.toFixed(2) : null,
        leftToBill: acc.contractValue ? Decimal.max(acc.contractValue.minus(acc.billed), ZERO).toFixed(2) : null,
        invoiced: acc.invoiced.toFixed(2),
        received: acc.received.toFixed(2),
        credited: acc.credited.toFixed(2),
        writtenOff: acc.writtenOff.toFixed(2),
        balanceDue: acc.balance.toFixed(2),
        overdue: acc.overdue.toFixed(2),
        retentionHeld: held.toFixed(2),
      };
    });

  openInvoices.sort((a, b) => b.daysOverdue - a.daysOverdue || (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const sum = (pick: (r: AccountRow) => string) => accounts.reduce((s, r) => s.plus(pick(r)), ZERO).toFixed(2);
  return { accounts, openInvoices, retentionHeld: sum((r) => r.retentionHeld), overdue: sum((r) => r.overdue) };
}
