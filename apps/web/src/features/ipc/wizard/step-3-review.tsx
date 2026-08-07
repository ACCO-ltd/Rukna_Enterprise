'use client';

import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input, Label, Select } from '@erp/ui';

import { formatMoney } from '@/lib/format';
import type { CertRow, AdHocDeduction, WizardContext } from './draft';
import type { ContractRetentionTerms, ContractAdvanceTerm, IpaItem } from '@/lib/api-types';

interface Step3Props {
  context: WizardContext;
  rows: CertRow[];
  items: IpaItem[];
  retentionTerms: ContractRetentionTerms | null;
  advanceTerms: ContractAdvanceTerm[];
  currency: string;
  adHocDeductions: AdHocDeduction[];
  onAdHocChange: (key: string, patch: Partial<AdHocDeduction>) => void;
  onAdHocAdd: () => void;
  onAdHocRemove: (key: string) => void;
  onBack: () => void;
  onIssue: () => void;
  isPending: boolean;
  errorMessage: string | undefined;
}

/** Estimates gross certified total from the row inputs. */
function estimateGross(rows: CertRow[], items: IpaItem[]): number {
  const itemMap = Object.fromEntries(items.map((i) => [i.id, i]));
  return rows.reduce((sum, row) => {
    const item = itemMap[row.applicationItemId];
    if (!item) return sum;
    const qty = parseFloat(row.certifiedQuantity);
    const rate = parseFloat(item.unitRateSnapshot);
    if (isNaN(qty) || isNaN(rate)) return sum;
    return sum + qty * rate;
  }, 0);
}

export function Step3Review({
  context,
  rows,
  items,
  retentionTerms,
  advanceTerms,
  currency,
  adHocDeductions,
  onAdHocChange,
  onAdHocAdd,
  onAdHocRemove,
  onBack,
  onIssue,
  isPending,
  errorMessage,
}: Step3Props) {
  const t = useTranslations('platform.ipc.wizard.step3');
  const tWiz = useTranslations('platform.ipc.wizard');
  const locale = useLocale() as 'en' | 'ar';

  const isRejected = context.status === 'REJECTED';

  const gross = isRejected ? 0 : estimateGross(rows, items);

  const estimatedRetention =
    !isRejected && retentionTerms
      ? gross * parseFloat(retentionTerms.retentionRate)
      : 0;

  const estimatedAdvance =
    !isRejected && advanceTerms.length > 0
      ? advanceTerms.reduce((sum, term) => sum + gross * parseFloat(term.recoveryRate), 0)
      : 0;

  const adHocTotal = adHocDeductions.reduce((sum, d) => {
    const amt = parseFloat(d.amount);
    return sum + (isNaN(amt) ? 0 : amt);
  }, 0);

  const estimatedNet = gross - estimatedRetention - estimatedAdvance - adHocTotal;

  const fmt = (n: number) => formatMoney(n.toFixed(2), currency, locale);

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">{t('description')}</p>

      {/* Summary card */}
      {!isRejected ? (
        <div className="rounded-lg border border-border bg-surface-subtle p-4 space-y-3">
          {/* Gross */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">{t('grossLabel')}</span>
            <bdi className="tabular-nums text-sm font-semibold text-foreground">{fmt(gross)}</bdi>
          </div>

          {/* Auto-deductions */}
          {(retentionTerms || advanceTerms.length > 0) ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t('autoDeductionsHeading')}
              </p>
              <p className="text-xs text-muted-foreground">{t('autoDeductionsNote')}</p>

              {retentionTerms ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">
                    {t('retentionLabel')}{' '}
                    <span className="text-xs text-muted-foreground">
                      ({(parseFloat(retentionTerms.retentionRate) * 100).toFixed(1)}%)
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    − <bdi className="tabular-nums">{fmt(estimatedRetention)}</bdi>{' '}
                    <span className="text-xs">({t('estimatedLabel')})</span>
                  </span>
                </div>
              ) : null}

              {advanceTerms.map((term) => (
                <div key={term.id} className="flex items-center justify-between">
                  <span className="text-sm text-foreground">
                    {t('advanceRecoveryLabel')}{' '}
                    <span className="text-xs text-muted-foreground">
                      ({(parseFloat(term.recoveryRate) * 100).toFixed(1)}%)
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    − <bdi className="tabular-nums">{fmt(gross * parseFloat(term.recoveryRate))}</bdi>{' '}
                    <span className="text-xs">({t('estimatedLabel')})</span>
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {/* Ad-hoc deductions */}
          {adHocTotal > 0 ? (
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-sm text-foreground">{t('adHocHeading')}</span>
              <bdi className="tabular-nums text-sm text-foreground">− {fmt(adHocTotal)}</bdi>
            </div>
          ) : null}

          {/* Net */}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-semibold text-foreground">{t('netEstimateLabel')}</span>
            <bdi className="tabular-nums text-base font-bold text-foreground">{fmt(estimatedNet)}</bdi>
          </div>

          <p className="text-xs text-muted-foreground">{t('serverComputeNote')}</p>
        </div>
      ) : null}

      {/* Ad-hoc deduction table */}
      {!isRejected ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{t('adHocHeading')}</h3>

          {adHocDeductions.length > 0 ? (
            <div className="space-y-3">
              {adHocDeductions.map((d) => (
                <AdHocRow
                  key={d.key}
                  deduction={d}
                  t={t}
                  onChange={(patch) => onAdHocChange(d.key, patch)}
                  onRemove={() => onAdHocRemove(d.key)}
                />
              ))}
            </div>
          ) : null}

          <Button type="button" variant="outline" size="sm" onClick={onAdHocAdd}>
            {t('addDeduction')}
          </Button>
        </div>
      ) : null}

      {errorMessage ? <Alert variant="error" messages={[errorMessage]} /> : null}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack} disabled={isPending}>
          {tWiz('nav.back')}
        </Button>
        <Button type="button" onClick={onIssue} disabled={isPending}>
          {isPending
            ? t('working')
            : isRejected
              ? t('rejectButton')
              : t('issueButton')}
        </Button>
      </div>
    </div>
  );
}

// ─── Ad-hoc deduction row ─────────────────────────────────────────────────────

interface AdHocRowProps {
  deduction: AdHocDeduction;
  t: ReturnType<typeof useTranslations>;
  onChange: (patch: Partial<AdHocDeduction>) => void;
  onRemove: () => void;
}

function AdHocRow({ deduction, t, onChange, onRemove }: AdHocRowProps) {
  const typeId = useId();
  const basisId = useId();
  const amountId = useId();

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-border p-3">
      <FormField htmlFor={typeId} label={t('adHocTypeLabel')} className="min-w-[140px] flex-1">
        <Select
          id={typeId}
          value={deduction.deductionType}
          onChange={(e) =>
            onChange({ deductionType: e.target.value as AdHocDeduction['deductionType'] })
          }
        >
          <option value="TAX">{t('deductionType.TAX')}</option>
          <option value="CONTRA">{t('deductionType.CONTRA')}</option>
          <option value="OTHER">{t('deductionType.OTHER')}</option>
        </Select>
      </FormField>

      <FormField htmlFor={basisId} label={t('adHocBasisLabel')} className="min-w-[140px] flex-1">
        <Input
          id={basisId}
          value={deduction.basis}
          onChange={(e) => onChange({ basis: e.target.value })}
          placeholder="Gross certified"
        />
      </FormField>

      <FormField htmlFor={amountId} label={t('adHocAmountLabel')} className="min-w-[120px] flex-1">
        <Input
          id={amountId}
          type="number"
          step="any"
          min="0"
          value={deduction.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
          placeholder="0.00"
          className="text-end"
        />
      </FormField>

      <div className="flex items-end pb-1">
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          {t('removeDeduction')}
        </Button>
      </div>
    </div>
  );
}
