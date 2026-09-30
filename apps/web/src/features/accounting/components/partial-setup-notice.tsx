'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Notice } from '@erp/ui';

import { existingRecordsList, type ExistingSetupRecord } from '../accounting-setup';

/**
 * The sentence explaining why the one-step setup (ADR-040) is unavailable although the chart is
 * empty: the organisation already has tax codes, posting profiles, bank accounts or fiscal years,
 * and the template cannot be installed over them (`PARTIAL_SETUP`).
 */
export function usePartialSetupMessage(): (records: readonly ExistingSetupRecord[]) => string {
  const t = useTranslations('accounting.setup.partial');
  const locale = useLocale();
  return (records) =>
    t('notice', {
      records:
        records.length > 0
          ? existingRecordsList(records, (record) => t(`record.${record}`), locale)
          : t('unknownRecords'),
    });
}

/** Shown to `manage:accounting` in place of the "Set up accounting" action. */
export function PartialSetupNotice({ records }: { records: readonly ExistingSetupRecord[] }) {
  const message = usePartialSetupMessage();
  return <Notice tone="attention">{message(records)}</Notice>;
}
