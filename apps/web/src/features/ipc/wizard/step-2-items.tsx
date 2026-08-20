'use client';

import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Button,
  cn,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  Textarea,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';
import type { IpaItem } from '@/features/ipa/types';
import type { BoqTreeNode } from '@/lib/api-types';

import type { CertRow } from './draft';

interface Step2Props {
  items: IpaItem[];
  rows: CertRow[];
  nodeMap: Record<string, BoqTreeNode>;
  currency: string;
  onRowChange: (applicationItemId: string, patch: Partial<CertRow>) => void;
  onBack: () => void;
  onNext: () => void;
  errors: Record<string, string>;
}

function estimateAmount(certifiedQty: string, unitRate: string): number | null {
  const qty = parseFloat(certifiedQty);
  const rate = parseFloat(unitRate);
  if (isNaN(qty) || isNaN(rate)) return null;
  return qty * rate;
}

function hasVariance(certifiedQty: string, cumulativeClaimed: string): boolean {
  const cert = parseFloat(certifiedQty);
  const claimed = parseFloat(cumulativeClaimed);
  if (isNaN(cert) || isNaN(claimed)) return false;
  return Math.abs(cert - claimed) > 0.0005;
}

export function Step2Items({
  items,
  rows,
  nodeMap,
  currency,
  onRowChange,
  onBack,
  onNext,
  errors,
}: Step2Props) {
  const t = useTranslations('platform.ipc.wizard.step2');
  const tWiz = useTranslations('platform.ipc.wizard');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const rowMap = Object.fromEntries(rows.map((r) => [r.applicationItemId, r]));

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t('description')}</p>

      <TableScroll aria-label={t('title')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky start-0 z-10 min-w-[160px] bg-surface-subtle shadow-[1px_0_0_0] shadow-border">
                {t('colItem')}
              </TableHead>
              <TableHead>{t('colMethod')}</TableHead>
              <TableHead numeric>{t('colCumClaimed')}</TableHead>
              <TableHead numeric>{t('colPrevCertified')}</TableHead>
              <TableHead numeric>{t('colPeriodClaimed')}</TableHead>
              <TableHead numeric className="min-w-[140px]">
                {t('colCertified')}
              </TableHead>
              <TableHead numeric>{t('colUnitRate')}</TableHead>
              <TableHead numeric>{t('colEstAmount')}</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                row={rowMap[item.id] ?? {
                  applicationItemId: item.id,
                  certifiedQuantity: item.cumulativeClaimed,
                  varianceReason: '',
                }}
                node={nodeMap[item.boqNodeId]}
                currency={currency}
                locale={locale}
                tStep2={t}
                tCommon={tCommon}
                onChange={(patch) => onRowChange(item.id, patch)}
                error={errors[item.id]}
              />
            ))}
          </TableBody>
        </Table>
      </TableScroll>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          {tWiz('nav.back')}
        </Button>
        <Button type="button" onClick={onNext}>
          {tWiz('nav.nextReview')}
        </Button>
      </div>
    </div>
  );
}

// ─── Single row ───────────────────────────────────────────────────────────────

interface ItemRowProps {
  item: IpaItem;
  row: CertRow;
  node: BoqTreeNode | undefined;
  currency: string;
  locale: 'en' | 'ar';
  tStep2: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
  onChange: (patch: Partial<CertRow>) => void;
  error: string | undefined;
}

function ItemRow({ item, row, node, currency, locale, tStep2, onChange, error }: ItemRowProps) {
  const certInputId = useId();
  const reasonId = useId();

  const description = node?.description ?? node?.code ?? item.boqNodeId;

  const showVariance = hasVariance(row.certifiedQuantity, item.cumulativeClaimed);
  const estimatedAmt = estimateAmount(row.certifiedQuantity, item.unitRateSnapshot);

  return (
    <>
      <TableRow className={cn(showVariance && 'bg-warning/5')}>
        {/* Description — sticky */}
        <TableCell className="sticky start-0 z-10 min-w-[160px] max-w-[240px] bg-surface shadow-[1px_0_0_0] shadow-border">
          <span className="line-clamp-2 text-sm">{description}</span>
        </TableCell>

        {/* Measurement method */}
        <TableCell>
          <span className="text-xs text-muted-foreground">
            {item.measurementMethodSnapshot}
          </span>
        </TableCell>

        {/* Cumulative claimed */}
        <TableCell numeric>
          <bdi className="tabular-nums">{item.cumulativeClaimed}</bdi>
        </TableCell>

        {/* Previously certified */}
        <TableCell numeric>
          <bdi className="tabular-nums">{item.previousEffectiveCertified}</bdi>
        </TableCell>

        {/* Period claimed */}
        <TableCell numeric>
          <bdi className="tabular-nums">{item.periodQuantity}</bdi>
        </TableCell>

        {/* Certified quantity input */}
        <TableCell numeric className="min-w-[140px]">
          <div className="space-y-1">
            <Input
              id={certInputId}
              type="number"
              step="any"
              min="0"
              value={row.certifiedQuantity}
              onChange={(e) => onChange({ certifiedQuantity: e.target.value })}
              className={cn('w-28 text-end', error && 'border-danger')}
              aria-describedby={error ? `${certInputId}-error` : undefined}
            />
            {error ? (
              <p id={`${certInputId}-error`} className="text-xs text-danger" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </TableCell>

        {/* Unit rate */}
        <TableCell numeric>
          <bdi className="tabular-nums text-muted-foreground text-xs">
            {formatMoney(item.unitRateSnapshot, item.currencySnapshot, locale)}
          </bdi>
        </TableCell>

        {/* Estimated amount */}
        <TableCell numeric>
          <bdi className="tabular-nums text-sm">
            {estimatedAmt !== null
              ? formatMoney(estimatedAmt.toFixed(2), currency, locale)
              : '—'}
          </bdi>
        </TableCell>
      </TableRow>

      {/* Variance reason row — only shown when certified ≠ claimed */}
      {showVariance ? (
        <TableRow className="bg-warning/5">
          <TableCell
            colSpan={8}
            className="pb-3 pt-0"
          >
            <div className="ps-0 space-y-1">
              <label htmlFor={reasonId} className="text-xs font-medium text-foreground">
                {tStep2('varianceReasonLabel')}
              </label>
              <Textarea
                id={reasonId}
                rows={2}
                value={row.varianceReason}
                onChange={(e) => onChange({ varianceReason: e.target.value })}
                placeholder={tStep2('varianceReasonPlaceholder')}
                className={cn(!row.varianceReason && 'border-warning')}
              />
              {!row.varianceReason ? (
                <p className="text-xs text-warning">{tStep2('varianceReasonRequired')}</p>
              ) : null}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
