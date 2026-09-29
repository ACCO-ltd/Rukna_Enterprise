'use client';

/**
 * ─── Export / print controls, shared by every accounting statement ────────────────
 *
 * One control pair — "Export CSV" and "Print" — reused across the Trial Balance, Balance
 * Sheet, Profit & Loss, Monthly Comparison and Account Ledger so the two actions look and
 * behave identically wherever a report is read.
 *
 * Both are `print:hidden`: they are tools for producing a printout, not part of it, so they
 * drop out of the printed page along with the rest of the app chrome (`@media print` in
 * `globals.css`). Export is disabled when there is nothing loaded to serialise — a CSV of an
 * empty or still-loading report is a file of headers and nothing else.
 */

import { useTranslations } from 'next-intl';
import { Button } from '@erp/ui';
import { Download, Printer } from 'lucide-react';

import { printReport } from '../lib/print';

export function ReportActions({
  onExport,
  exportDisabled = false,
}: {
  /** Builds and downloads the CSV from the report's already-loaded rows. */
  onExport: () => void;
  /** No rows loaded yet (pending, error, or empty) — nothing to export. */
  exportDisabled?: boolean;
}) {
  const t = useTranslations('accounting.reportActions');

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onExport}
        disabled={exportDisabled}
        className="gap-1.5"
      >
        <Download size={16} aria-hidden="true" />
        {t('exportCsv')}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => printReport()}
        className="gap-1.5"
      >
        <Printer size={16} aria-hidden="true" />
        {t('print')}
      </Button>
    </div>
  );
}
