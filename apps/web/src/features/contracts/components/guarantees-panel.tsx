'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocale, useTranslations } from 'next-intl';
import { GuaranteeStatus } from '@erp/types';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
  Select,
  type BadgeTone,
} from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

import { toDecimalString } from '../contract-form-payload';
import { isLapsed, lapsedGuarantees } from '../contract-terms';
import { useAddGuarantee, useUpdateGuarantee } from '../hooks/use-contract-terms';
import type { ContractGuarantee } from '../types';

const CURRENCIES = ['USD', 'SOS', 'AED'] as const;

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
        <AddGuaranteeDialog
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
          <p className="mt-1 text-sm font-semibold text-foreground" dir="ltr">
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
            onChange={(e) => {
              update.mutate({
                guaranteeId: guarantee.id,
                status: e.target.value as GuaranteeStatus,
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

interface GuaranteeFormValues {
  guaranteeType: string;
  amount: string;
  currency: string;
  issuer: string;
  beneficiary: string;
  issueDate: string;
  expiryDate: string;
  notes: string;
}

function AddGuaranteeDialog({
  contractId,
  onClose,
}: {
  contractId: string;
  onClose: () => void;
}) {
  const t = useTranslations('platform.contracts.terms.guarantees');
  const tCommon = useTranslations('common');
  const tCurrency = useTranslations('common.currency');
  const add = useAddGuarantee(contractId);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<GuaranteeFormValues>({
    defaultValues: {
      guaranteeType: 'PERFORMANCE',
      amount: '',
      currency: 'USD',
      issuer: '',
      beneficiary: '',
      issueDate: '',
      expiryDate: '',
      notes: '',
    },
  });

  const onSubmit = (values: GuaranteeFormValues) => {
    add.mutate(
      {
        guaranteeType: values.guaranteeType.trim(),
        amount: toDecimalString(values.amount),
        currency: values.currency,
        issuer: values.issuer.trim(),
        beneficiary: values.beneficiary.trim(),
        issueDate: values.issueDate,
        expiryDate: values.expiryDate,
        ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
      },
      { onSuccess: onClose },
    );
  };

  const required = { validate: (v: string) => v.trim() !== '' || t('required') };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !add.isPending) onClose();
      }}
    >
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (add.isPending) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (add.isPending) e.preventDefault();
        }}
      >
        <DialogTitle>{t('add')}</DialogTitle>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 space-y-4"
          noValidate
        >
          {add.isError ? <Alert variant="error" messages={[t('failed')]} /> : null}

          <FormField
            htmlFor="guarantee-type"
            label={t('type')}
            error={errors.guaranteeType?.message}
          >
            <Input
              id="guarantee-type"
              aria-describedby="guarantee-type-hint"
              aria-invalid={Boolean(errors.guaranteeType)}
              {...register('guaranteeType', required)}
            />
            <p id="guarantee-type-hint" className="text-xs text-muted-foreground">
              {t('typeHint')}
            </p>
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField htmlFor="guarantee-amount" label={t('amount')} error={errors.amount?.message}>
              <Input
                id="guarantee-amount"
                inputMode="decimal"
                dir="ltr"
                aria-invalid={Boolean(errors.amount)}
                {...register('amount', {
                  validate: (v) =>
                    (v.trim() !== '' && Number.isFinite(Number(v))) || t('required'),
                })}
              />
            </FormField>

            <FormField htmlFor="guarantee-currency" label={t('currency')}>
              <Select id="guarantee-currency" {...register('currency')}>
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {tCurrency(code.toLowerCase())}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <FormField htmlFor="guarantee-issuer" label={t('issuer')} error={errors.issuer?.message}>
            <Input
              id="guarantee-issuer"
              aria-invalid={Boolean(errors.issuer)}
              {...register('issuer', required)}
            />
          </FormField>

          <FormField
            htmlFor="guarantee-beneficiary"
            label={t('beneficiary')}
            error={errors.beneficiary?.message}
          >
            <Input
              id="guarantee-beneficiary"
              aria-invalid={Boolean(errors.beneficiary)}
              {...register('beneficiary', required)}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              htmlFor="guarantee-issue"
              label={t('issueDate')}
              error={errors.issueDate?.message}
            >
              <Input
                id="guarantee-issue"
                type="date"
                aria-invalid={Boolean(errors.issueDate)}
                {...register('issueDate', required)}
              />
            </FormField>

            <FormField
              htmlFor="guarantee-expiry"
              label={t('expiryDate')}
              error={errors.expiryDate?.message}
            >
              <Input
                id="guarantee-expiry"
                type="date"
                aria-invalid={Boolean(errors.expiryDate)}
                {...register('expiryDate', {
                  validate: (v) => {
                    if (v.trim() === '') return t('required');
                    const issue = getValues('issueDate');
                    // A guarantee that expires before it was issued is a data-entry error
                    // the API does not catch — both dates are only @IsDateString().
                    return !issue || v >= issue || t('expiryBeforeIssue');
                  },
                })}
              />
            </FormField>
          </div>

          <FormField htmlFor="guarantee-notes" label={t('notes')}>
            <Input id="guarantee-notes" {...register('notes')} />
          </FormField>

          <DialogFooter>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? tCommon('loading') : t('save')}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={add.isPending}>
              {tCommon('cancel')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
