'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CircleAlert, CircleCheck, CircleDot, Info } from 'lucide-react';
import { FormField, Select, SkeletonTable, SwitchField, cn } from '@erp/ui';
import { PERMISSIONS, type CloseCheckStatus, type CloseChecklist as CloseChecklistData } from '@erp/types';

import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { usePermissions } from '@/features/auth/permissions/can';
import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

const getChecklist = (periodId?: string) =>
  apiClient<CloseChecklistData>(periodId ? `/finance/close-checklist?periodId=${encodeURIComponent(periodId)}` : '/finance/close-checklist');
const setPolicy = (requireBankReconciliation: boolean) =>
  apiClient<{ requireBankReconciliation: boolean }>('/finance/close-checklist/policy', { method: 'PUT', body: JSON.stringify({ requireBankReconciliation }) });

const ICON: Record<CloseCheckStatus, { Icon: typeof CircleCheck; className: string }> = {
  DONE: { Icon: CircleCheck, className: 'text-success' },
  TODO: { Icon: CircleDot, className: 'text-brand-primary' },
  BLOCKED: { Icon: CircleAlert, className: 'text-danger' },
  INFO: { Icon: Info, className: 'text-muted-foreground' },
};

/**
 * Step 6 — the month-end close checklist: what has to be true before a month closes, read live
 * from the ledger, each check linking to the screen that fixes it. Lock and close themselves stay
 * on the periods screen, behind the same close gate this list mirrors.
 */
export function CloseChecklist() {
  const t = useTranslations('finance.close');
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [periodId, setPeriodId] = useState<string | undefined>(undefined);
  const query = useQuery({ queryKey: ['finance', 'close-checklist', periodId ?? 'default'], queryFn: () => getChecklist(periodId) });
  const policy = useMutation({
    mutationFn: setPolicy,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['finance', 'close-checklist'] }),
  });

  if (query.isError) return <LoadError message={t('loadFailed')} onRetry={() => void query.refetch()} />;
  if (query.isPending) return <SkeletonTable rows={6} columns={2} label={t('loading')} />;
  const c = query.data;
  const done = c.checks.filter((x) => x.status === 'DONE').length;

  return (
    <div className="max-w-3xl space-y-6">
      <ListPageHeader
        title={t('title', { period: c.period.name })}
        summary={c.period.status === 'CLOSED' ? t('closed') : c.readyToClose ? t('ready') : t('progress', { done, total: c.checks.length })}
      />

      <div className="flex flex-wrap items-end gap-4">
        <FormField htmlFor="close-period" label={t('period')}>
          <Select id="close-period" value={c.period.id} onChange={(v) => setPeriodId(v || undefined)}>
            {[c.period, ...c.periods.filter((p) => p.id !== c.period.id)].map((p) => (
              <option key={p.id} value={p.id}>{`${p.name} · ${t(`periodStatus.${p.status}`)}`}</option>
            ))}
          </Select>
        </FormField>
        <p className="pb-2 text-body-sm text-muted-foreground">
          {formatDate(c.period.startDate) ?? c.period.startDate} – {formatDate(c.period.endDate) ?? c.period.endDate}
        </p>
      </div>

      <ol className="space-y-3" aria-label={t('checksLabel')}>
        {c.checks.map((check) => {
          const { Icon, className } = ICON[check.status];
          return (
            <li key={check.key} className="rounded-panel border border-border bg-surface px-4 py-3">
              <div className="flex items-start gap-3">
                <Icon size={18} className={cn('mt-0.5 shrink-0', className)} aria-label={t(`status.${check.status}`)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-body font-semibold text-foreground">{t(`checks.${check.key}`)}</h2>
                    {check.href ? <Link href={check.href} className="text-body-sm font-medium text-brand-primary hover:underline">{t(`open.${check.key}`)}</Link> : null}
                  </div>
                  <p className="text-body-sm text-muted-foreground">{check.detail}</p>
                  {check.items.length > 0 ? (
                    <ul className="mt-2 divide-y divide-border">
                      {check.items.map((item) => {
                        const ItemIcon = ICON[item.status].Icon;
                        return (
                          <li key={item.key} className="flex items-center justify-between gap-3 py-1.5 text-body-sm">
                            <span className="flex min-w-0 items-center gap-2">
                              <ItemIcon size={14} className={cn('shrink-0', ICON[item.status].className)} aria-label={t(`status.${item.status}`)} />
                              {item.href && item.status !== 'DONE' ? (
                                <Link href={item.href} className="truncate text-foreground hover:underline">{item.label}</Link>
                              ) : (
                                <span className="truncate text-foreground">{item.label}</span>
                              )}
                            </span>
                            <span className="shrink-0 text-caption text-muted-foreground">{item.detail}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {can(PERMISSIONS.accountingManage) ? (
        <SwitchField
          id="require-bank-rec"
          checked={c.requireBankReconciliation}
          onCheckedChange={(v) => policy.mutate(v)}
          disabled={policy.isPending}
          label={t('policyLabel')}
          description={t('policyHint')}
        />
      ) : null}
    </div>
  );
}
