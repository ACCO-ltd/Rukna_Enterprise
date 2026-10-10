'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ViewSwitcher } from '@erp/ui';

import { JournalsList } from '@/features/accounting/components/journals-list';
import { LedgerView, accountingLedgerLinks } from '@/features/finance/components/ledger-view';
import { ProfitLossView } from '@/features/finance/components/profit-loss-view';
import { SupplierBillsList } from '@/features/procurement/components/bill-screens';
import { SupplierPaymentsList } from '@/features/procurement/components/payment-screens';
import { ReceiptsList } from '@/features/receipts/components/receipts-list';

import { useCanViewProjectPayables, useProjectPaymentsAccess } from '../hooks';

/** The Transactions views, in reading order: money owed out, paid out, received, adjusted, then the books. */
export const TRANSACTION_VIEWS = ['bills', 'supplierPayments', 'receipts', 'journals', 'ledger', 'pl'] as const;
export type TransactionView = (typeof TRANSACTION_VIEWS)[number];

/** Views whose component carries its own heading and description — a second one would repeat it. */
const SELF_TITLED: ReadonlySet<TransactionView> = new Set(['ledger', 'pl']);

/** The views this reader may open — each list keeps its own API gate. Ledger and P&L ride on the workspace's. */
export function useTransactionViews(): TransactionView[] {
  const canPayables = useCanViewProjectPayables();
  const access = useProjectPaymentsAccess();
  return TRANSACTION_VIEWS.filter((view) => {
    switch (view) {
      case 'bills':
        return canPayables;
      case 'supplierPayments':
        return access.supplierPayments;
      case 'receipts':
        return access.receipts;
      case 'journals':
        return access.journals;
      default:
        return true;
    }
  });
}

/** The `?view=` value if this reader may open it, else their first view. */
export function resolveTransactionView(value: string | null | undefined, allowed: readonly TransactionView[]): TransactionView {
  return allowed.includes(value as TransactionView) ? (value as TransactionView) : allowed[0]!;
}

/**
 * Finance → Projects → Transactions (ADR-043 amendment, 2026-10-10): every money movement of the
 * project in one place, one view at a time — supplier bills, supplier payments, client receipts,
 * journals, the ledger and the P&L. It replaces the Payables, Payments and P&L tabs. Each view is
 * the SAME list its accounting page renders, fixed to the project server-side (`?projectId=`); a
 * row opens that record's own page, where its commands live. The view is in the URL (`?view=`).
 */
export function FinanceProjectTransactions({ projectId }: { projectId: string }) {
  const t = useTranslations('finance.projects.transactions');
  const router = useRouter();
  const pathname = usePathname() ?? `/finance/projects/${projectId}/transactions`;
  const searchParams = useSearchParams();
  const allowed = useTransactionViews();
  const view = resolveTransactionView(searchParams?.get('view'), allowed);

  const setView = (next: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('view', next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-4" data-finance-transactions>
      <ViewSwitcher
        aria-label={t('label')}
        value={view}
        onValueChange={setView}
        items={allowed.map((key) => ({ value: key, label: t(`views.${key}`) }))}
      />
      {SELF_TITLED.has(view) ? (
        <TransactionBody view={view} projectId={projectId} />
      ) : (
        <section aria-labelledby="finance-transactions-title" className="space-y-3">
          <div>
            <h2 id="finance-transactions-title" className="text-h3 font-semibold text-foreground">
              {t(`views.${view}`)}
            </h2>
            <p className="text-caption text-muted-foreground">{t(`hints.${view}`)}</p>
          </div>
          <TransactionBody view={view} projectId={projectId} />
        </section>
      )}
    </div>
  );
}

function TransactionBody({ view, projectId }: { view: TransactionView; projectId: string }) {
  switch (view) {
    case 'bills':
      return <SupplierBillsList projectId={projectId} />;
    case 'supplierPayments':
      return <SupplierPaymentsList projectId={projectId} />;
    case 'receipts':
      return <ReceiptsList projectId={projectId} />;
    case 'journals':
      return <JournalsList projectId={projectId} />;
    case 'ledger':
      return <LedgerView projectId={projectId} links={accountingLedgerLinks} />;
    case 'pl':
      return <ProfitLossView projectId={projectId} />;
  }
}
