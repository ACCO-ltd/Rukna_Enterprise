'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { GuaranteeStatus } from '@erp/types';
import { Alert, Badge, Button, Select, type BadgeTone } from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

import { isLapsed, lapsedGuarantees } from '../contract-terms';
import { useUpdateGuarantee } from '../hooks/use-contract-terms';
import type { ContractGuarantee } from '../types';
import { GuaranteeFormDialog } from './guarantee-form-dialog';

const GUARANTEE_STATUSES: GuaranteeStatus[] = [
  GuaranteeStatus.ACTIVE,
  GuaranteeStatus.DISCHARGED,
  GuaranteeStatus.EXPIRED,
  GuaranteeStatus.CALLED,
];

const STATUS_TONES: Record<GuaranteeStatus, BadgeTone> = {
  [GuaranteeStatus.ACTIVE]: 'live',
  [GuaranteeStatus.DISCHARGED]: 'neutral',
  [GuaranteeStatus.EXPIRED]: 'neutral',
  [GuaranteeStatus.CALLED]: 'danger',
};

interface GuaranteesPanelProps {
  contractId: string;
  guarantees: ContractGuarantee[];
  /** Today as `YYYY-MM-DD`, passed in so expiry logic stays pure and testable. */
  today: string;
  canEdit: boolean;
}

export function GuaranteesPanel({
  contractId,
  guarantees,
  today,
  canEdit,
}: GuaranteesPanelProps) {
  const t = useTranslations('platform.contracts.terms.guarantees');
  const locale = useLocale() as 'en' | 'ar';
  const [isAdding, setIsAdding] = useState(false);

  const lapsed = lapsedGuarantees(guarantees, today);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
        {canEdit ? (
          <Button
            size="sm"
            onClick={() => {
              setIsAdding(true);
            }}
          >
            {t('add')}
          </Button>
        ) : null}
      </div>

      {/* Nothing on the API moves a guarantee to EXPIRED — the schema indexes
          [expiryDate, status] for a job that was never written — so cover can lapse while
          the record still claims it is active. That gap is worth naming at the top. */}
      {lapsed.length > 0 ? (
        <Alert variant="warning" messages={[t('lapsedSummary', { count: lapsed.length })]} />
      ) : null}

      {guarantees.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('none')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('noneHint')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {guarantees.map((guarantee) => (
            <GuaranteeCard
              key={guarantee.id}
              contractId={contractId}
              guarantee={guarantee}
              lapsed={isLapsed(guarantee, today)}
              locale={locale}
            />
          ))}
        </ul>
      )}

      {isAdding ? (
        <GuaranteeFormDialog
          contractId={contractId}
          onClose={() => {
            setIsAdding(false);
          }}
        />
      ) : null}
    </section>
  );
}

function GuaranteeCard({
  contractId,
  guarantee,
  lapsed,
  locale,
}: {
  contractId: string;
  guarantee: ContractGuarantee;
  lapsed: boolean;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('platform.contracts.terms.guarantees');
  // A guarantee runs on its own clock and is discharged or called on dates unrelated to
  // the contract's lifecycle — often after it closes — so status stays editable always.
  const update = useUpdateGuarantee(contractId);

  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{guarantee.guaranteeType}</span>
            <Badge tone={STATUS_TONES[guarantee.status] ?? 'neutral'}>
              {t(`statuses.${guarantee.status}`)}
            </Badge>
            {lapsed ? <Badge tone="warning">{t('lapsed')}</Badge> : null}
          </div>
          {/* No `dir` on money. `Intl.NumberFormat` already emits a right-to-left mark for
              Arabic, so the string lays itself out correctly by inheriting the page
              direction — forcing `ltr` here made the same amount render one way inside
              this panel and another in the page heading. `dir="ltr"` is for genuinely
              latin-script identifiers: tax numbers, emails, contract codes. */}
          <p className="mt-1 text-sm font-semibold text-foreground">
            {formatMoney(guarantee.amount, guarantee.currency, locale)}
          </p>
        </div>

        <div className="min-w-40">
          <label htmlFor={`guarantee-status-${guarantee.id}`} className="sr-only">
            {t('changeStatus')}
          </label>
          <Select
            id={`guarantee-status-${guarantee.id}`}
            value={guarantee.status}
            disabled={update.isPending}
            onChange={(value) => {
              update.mutate({
                guaranteeId: guarantee.id,
                status: value as GuaranteeStatus,
              });
            }}
          >
            {GUARANTEE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`statuses.${status}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {lapsed ? <p className="mt-2 text-xs text-warning">{t('lapsedHint')}</p> : null}

      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">{t('issuer')}</dt>
          <dd className="text-foreground">{guarantee.issuer}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('beneficiary')}</dt>
          <dd className="text-foreground">{guarantee.beneficiary}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('issueDate')}</dt>
          <dd className="text-foreground">{formatDate(guarantee.issueDate, locale)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('expiryDate')}</dt>
          <dd className={lapsed ? 'font-medium text-warning' : 'text-foreground'}>
            {formatDate(guarantee.expiryDate, locale)}
          </dd>
        </div>
      </dl>

      {guarantee.notes ? (
        <p className="mt-3 text-xs text-muted-foreground">{guarantee.notes}</p>
      ) : null}

      {update.isError ? (
        <div className="mt-3">
          <Alert variant="error" messages={[t('updateFailed')]} />
        </div>
      ) : null}
    </li>
  );
}
