'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, Notice } from '@erp/ui';

import { useAccountingReadiness } from '../hooks/use-accounting-readiness';

/**
 * "Invoices can't be posted until accounting setup is finished" — one notice, shown where
 * money is posted (Billing & collection, Contract & milestones, the invoice page). Renders
 * nothing while readiness is unknown or ready. Flow plan A7 / CONST-COM-025: the blocked
 * action is hidden and its reason is stated at the point of action, with the way to fix it.
 */
export function AccountingSetupNotice() {
  const t = useTranslations('finance.setupNotice');
  const readiness = useAccountingReadiness();
  if (!readiness.data || readiness.data.ready) return null;

  const first = readiness.data.blockers[0]?.code;
  const href =
    first === 'NO_OPEN_PERIOD' ? '/finance/accounting/periods' : '/finance/accounting/chart-of-accounts';

  return (
    <Notice
      tone="attention"
      title={t('title')}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href={href}>{t('action')}</Link>
        </Button>
      }
    >
      {t('body', { items: readiness.data.blockers.map((blocker) => blocker.label).join(', ') })}
    </Notice>
  );
}
