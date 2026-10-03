'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@erp/ui';

/** "Export CSV" and "Export Excel" — the same rows on screen, two formats. Hidden when printing. */
export function ExportButtons({
  onCsv,
  onXlsx,
  disabled = false,
}: {
  onCsv: () => void;
  onXlsx: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations('finance.exports');
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button type="button" variant="outline" size="sm" onClick={onCsv} disabled={disabled} className="gap-1.5">
        <Download size={16} aria-hidden="true" />
        {t('csv')}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onXlsx} disabled={disabled} className="gap-1.5">
        <Download size={16} aria-hidden="true" />
        {t('xlsx')}
      </Button>
    </div>
  );
}
