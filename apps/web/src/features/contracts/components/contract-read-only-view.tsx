'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, DefinitionList, DefinitionRow } from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

import type { Contract } from '../types';

/**
 * The same five facts `ContractForm` edits (number, value, billing model, start date,
 * expected completion), shown as text instead of inputs, with a plain reason why this
 * contract isn't editable here right now.
 *
 * Rendered as a genuinely separate component from `ContractForm` — not an internal
 * `readOnly` branch of it — so nothing here ever needs the form's hooks (react-hook-form,
 * the update mutation) mounted just to sit unused.
 */
export function ContractReadOnlyView({
  contract,
  backHref,
  reason,
}: {
  contract: Contract;
  backHref: string;
  reason: 'noPermission' | 'notDraft';
}) {
  const t = useTranslations('platform.contracts.detail');
  const tContracts = useTranslations('platform.contracts');
  const locale = useLocale() as 'en';

  return (
    <div className="space-y-5 rounded-panel border border-border bg-surface p-5 sm:p-8">
      <Alert
        variant={reason === 'noPermission' ? 'info' : 'warning'}
        messages={[reason === 'noPermission' ? t('noEditPermission') : t('editOnlyDraft')]}
      />

      <DefinitionList>
        <DefinitionRow label={t('number')}>{contract.contractNumber}</DefinitionRow>
        <DefinitionRow label={t('value')} numeric>
          {formatMoney(contract.contractValue, contract.currency, locale) ?? contract.contractValue}
        </DefinitionRow>
        <DefinitionRow label={t('billingModel')}>
          {tContracts(`billingModel.${contract.billingModel}`)}
        </DefinitionRow>
        <DefinitionRow label={t('startDate')}>
          {contract.startDate ? (formatDate(contract.startDate, locale) ?? contract.startDate) : null}
        </DefinitionRow>
        <DefinitionRow label={t('expectedEnd')}>
          {contract.expectedEndDate
            ? (formatDate(contract.expectedEndDate, locale) ?? contract.expectedEndDate)
            : null}
        </DefinitionRow>
      </DefinitionList>

      <div className="flex justify-end">
        <Button variant="outline" asChild>
          <Link href={backHref}>{t('back')}</Link>
        </Button>
      </div>
    </div>
  );
}
