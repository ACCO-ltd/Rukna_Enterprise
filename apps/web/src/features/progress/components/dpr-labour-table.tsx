'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { DprLabourRowResponse } from '@erp/types';
import { Alert, Button, Input, Label, Select } from '@erp/ui';
import { Plus, Trash2 } from 'lucide-react';

import { ApiError } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { useSuppliers } from '@/features/procurement/hooks/use-procurement';

import { useAddLabourRow, useRemoveLabourRow } from '../hooks/use-progress';
import { TRADE_OPTIONS } from './dpr-detail';

/**
 * Labour and hours, as the daily report dialog shows it: an inline table (Trade · Headcount ·
 * Contractor · Hours per worker) with the rows already on the report and one "add row" line at the
 * bottom. Each row saves as it is added, like everything else on the report.
 *
 * From `sm` the rows sit on one grid so the columns line up under the header; on a phone each row
 * stacks with its own labels, so nothing scrolls sideways.
 *
 * `onDirtyChange` reports a half-typed add-row line (a trade, headcount or hours not yet added), so
 * the dialog can ask before that is thrown away.
 */
const GRID = 'sm:grid sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_7rem] sm:items-center sm:gap-3';

export function DprLabourTable({
  dprId,
  rows,
  onDirtyChange,
}: {
  dprId: string;
  rows: DprLabourRowResponse[];
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const add = useAddLabourRow(dprId);
  const remove = useRemoveLabourRow(dprId);
  const suppliers = useSuppliers({ status: 'ACTIVE' });

  const direct = t('labour.fields.contractorDefault');
  const [trade, setTrade] = useState('');
  const [headcount, setHeadcount] = useState('');
  // Direct labour by default; only a subcontracted trade changes it.
  const [contractor, setContractor] = useState(direct);
  const [hours, setHours] = useState('');
  const [error, setError] = useState<string | null>(null);

  const dirty = trade !== '' || headcount !== '' || hours !== '';
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const contractorOptions = useMemo(
    () => [direct, ...(suppliers.data?.map((s) => s.name) ?? [])],
    [suppliers.data, direct],
  );

  const canAdd = trade.trim() !== '' && headcount !== '' && Number(headcount) >= 0 && !add.isPending;

  function onAdd(event: React.FormEvent) {
    event.preventDefault();
    // A nested form's submit must not reach the dialog's own form.
    event.stopPropagation();
    if (!canAdd) return;
    setError(null);
    add.mutate(
      {
        trade: trade.trim(),
        headcount: Number(headcount),
        contractor: contractor || undefined,
        hours: hours ? Number(hours) : undefined,
      },
      {
        onSuccess: () => {
          setTrade('');
          setHeadcount('');
          setContractor(direct);
          setHours('');
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : t('states.loadFailed')),
      },
    );
  }

  function onRemove(rowId: string) {
    setError(null);
    remove.mutate(rowId, {
      onError: (err) => setError(err instanceof ApiError ? err.message : t('states.loadFailed')),
    });
  }

  const headClass = 'text-caption font-medium text-muted-foreground';

  return (
    <div className="space-y-3">
      {error ? <Alert variant="error" messages={[error]} /> : null}

      <div className="overflow-hidden rounded-panel border border-border">
        {/* Column header — visual only from sm; each cell below carries its own label for AT. */}
        <div aria-hidden="true" className={`hidden border-b border-border bg-surface-subtle px-3 py-2 ${GRID}`}>
          <span className={headClass}>{t('entry.labourTable.trade')}</span>
          <span className={`${headClass} text-end`}>{t('entry.labourTable.headcount')}</span>
          <span className={headClass}>{t('entry.labourTable.contractor')}</span>
          <span className={`${headClass} text-end`}>{t('entry.labourTable.hours')}</span>
          <span />
        </div>

        {rows.length > 0 ? (
          <ul aria-label={t('entry.labour')} className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className={`grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2.5 ${GRID}`}>
                <span className="min-w-0 text-body-sm font-medium text-foreground">{row.trade}</span>
                <span className="text-body-sm tabular-nums text-foreground sm:text-end">
                  <span className="text-muted-foreground sm:sr-only">{t('entry.labourTable.headcount')}: </span>
                  {row.headcount}
                </span>
                <span className="col-span-2 row-start-3 text-body-sm text-muted-foreground sm:col-span-1 sm:row-start-auto">
                  <span className="sm:sr-only">{t('entry.labourTable.contractor')}: </span>
                  {row.contractor ?? '—'}
                </span>
                <span className="text-body-sm tabular-nums text-foreground sm:text-end">
                  <span className="text-muted-foreground sm:sr-only">{t('entry.labourTable.hours')}: </span>
                  {row.hours != null ? formatNumber(Number(row.hours), locale, 1) : '—'}
                  {row.hours != null ? (
                    <span className="block text-caption text-muted-foreground">
                      {formatNumber(row.headcount * Number(row.hours), locale, 0)} {t('labour.fields.manHours')}
                    </span>
                  ) : null}
                </span>
                <span className="col-start-2 row-start-1 flex justify-end sm:col-start-auto sm:row-start-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('entry.labourTable.removeLabel', { trade: row.trade })}
                    onClick={() => onRemove(row.id)}
                    disabled={remove.isPending}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-body-sm text-muted-foreground">{t('labour.empty')}</p>
        )}

        {/* The one add-row line. */}
        <form
          onSubmit={onAdd}
          aria-label={t('entry.labourTable.addRow')}
          className={`grid gap-3 border-t border-border bg-surface-subtle px-3 py-3 ${GRID}`}
        >
          <div className="space-y-1 sm:space-y-0">
            <Label htmlFor="labour-new-trade" className="text-caption sm:sr-only">
              {t('entry.labourTable.trade')}
            </Label>
            <Select id="labour-new-trade" value={trade} onChange={setTrade}>
              <option value="">{t('labour.tradeChoose')}</option>
              {TRADE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1 sm:space-y-0">
            <Label htmlFor="labour-new-headcount" className="text-caption sm:sr-only">
              {t('entry.labourTable.headcount')}
            </Label>
            <Input
              id="labour-new-headcount"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={headcount}
              onChange={(e) => setHeadcount(e.target.value)}
              className="text-end"
            />
          </div>
          <div className="space-y-1 sm:space-y-0">
            <Label htmlFor="labour-new-contractor" className="text-caption sm:sr-only">
              {t('entry.labourTable.contractor')}
            </Label>
            <Select
              id="labour-new-contractor"
              value={contractor}
              onChange={setContractor}
              disabled={suppliers.isPending}
            >
              {contractorOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1 sm:space-y-0">
            <Label htmlFor="labour-new-hours" className="text-caption sm:sr-only">
              {t('entry.labourTable.hours')}
            </Label>
            <Input
              id="labour-new-hours"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="text-end"
            />
          </div>
          <div className="flex sm:justify-end">
            <Button type="submit" variant="outline" size="sm" disabled={!canAdd} className="w-full sm:w-auto">
              <Plus className="me-1.5 size-4" aria-hidden="true" />
              {add.isPending ? t('labour.saving') : t('entry.labourTable.addRow')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
