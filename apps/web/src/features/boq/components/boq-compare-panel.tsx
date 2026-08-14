'use client';

import type { BoqChangeKind, BoqCompareResponse } from '@erp/types';
import { Download } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  LtrValue,
  Sheet,
  SheetContent,
  SheetFooter,
  SheetTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  cn,
  type BadgeTone,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';

const KIND_TONE: Partial<Record<BoqChangeKind, BadgeTone>> = {
  ADDED: 'live',
  REMOVED: 'danger',
  VARIATION_ORIGINATED: 'info',
};

/**
 * Version comparison.
 *
 * The server does the diff. It pairs on `originNodeId` rather than on code, so a renumbered
 * line reads as one rate change rather than a removal plus an addition — which is the
 * difference between "this rate went up 8%" and "someone deleted a line and added another".
 */
export function BoqComparePanel({
  diff,
  isPending,
  isError,
  canViewCommercials,
  onExport,
  onClose,
}: {
  diff: BoqCompareResponse | undefined;
  isPending: boolean;
  isError: boolean;
  canViewCommercials: boolean;
  onExport: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('platform.boq.compare');
  const locale = useLocale() as 'en' | 'ar';

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="sm:w-[min(56rem,100vw)]">
        <div className="px-5 pb-4 pt-10">
          <SheetTitle>{t('heading')}</SheetTitle>
          {diff ? (
            <p className="mt-1 text-body-sm text-muted-foreground">
              {t('between', {
                left: diff.leftVersionNumber,
                right: diff.rightVersionNumber,
              })}
            </p>
          ) : null}
        </div>

        <div className="border-t border-border" />

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {isPending ? <Skeleton className="h-64 w-full" /> : null}
          {isError ? <Alert variant="error" messages={[t('loadFailed')]} /> : null}

          {diff ? (
            <>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-4">
                <Stat label={t('added')} value={String(diff.addedCount)} />
                <Stat label={t('removed')} value={String(diff.removedCount)} />
                <Stat label={t('changed')} value={String(diff.changedCount)} />
                <Stat
                  label={t('netDelta')}
                  value={
                    canViewCommercials
                      ? (formatMoney(diff.netDelta, diff.currency, locale) ?? '—')
                      : t('restricted')
                  }
                  emphasis={
                    canViewCommercials && diff.netDelta
                      ? diff.netDelta.startsWith('-')
                        ? 'down'
                        : 'up'
                      : undefined
                  }
                />
              </dl>

              <TableScroll>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('code')}</TableHead>
                      <TableHead>{t('description')}</TableHead>
                      <TableHead>{t('change')}</TableHead>
                      {canViewCommercials ? (
                        <>
                          <TableHead numeric>{t('was')}</TableHead>
                          <TableHead numeric>{t('now')}</TableHead>
                          <TableHead numeric>{t('delta')}</TableHead>
                        </>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {diff.changes.length === 0 ? (
                      <TableEmpty colSpan={canViewCommercials ? 6 : 3}>
                        {t('noChanges')}
                      </TableEmpty>
                    ) : (
                      diff.changes.map((change) => (
                        <TableRow key={`${change.leftNodeId ?? ''}-${change.rightNodeId ?? ''}`}>
                          <TableCell>
                            <LtrValue className="font-mono text-caption">{change.code}</LtrValue>
                          </TableCell>
                          <TableCell className="max-w-64 truncate">{change.description}</TableCell>
                          <TableCell>
                            <span className="flex flex-wrap gap-1">
                              {change.kinds.map((kind) => (
                                <Badge key={kind} tone={KIND_TONE[kind] ?? 'neutral'}>
                                  {t(`kind.${kind}`)}
                                </Badge>
                              ))}
                            </span>
                          </TableCell>
                          {canViewCommercials ? (
                            <>
                              <TableCell numeric>
                                <LtrValue>
                                  {formatMoney(change.oldAmount, diff.currency, locale) ?? '—'}
                                </LtrValue>
                              </TableCell>
                              <TableCell numeric>
                                <LtrValue>
                                  {formatMoney(change.newAmount, diff.currency, locale) ?? '—'}
                                </LtrValue>
                              </TableCell>
                              <TableCell
                                numeric
                                className={cn(
                                  change.amountDelta?.startsWith('-')
                                    ? 'text-success'
                                    : change.amountDelta
                                      ? 'text-warning'
                                      : undefined,
                                )}
                              >
                                <LtrValue>
                                  {change.amountDelta
                                    ? `${formatMoney(change.amountDelta, diff.currency, locale)}${
                                        change.amountDeltaPercent
                                          ? ` (${change.amountDeltaPercent}%)`
                                          : ''
                                      }`
                                    : '—'}
                                </LtrValue>
                              </TableCell>
                            </>
                          ) : null}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableScroll>
            </>
          ) : null}
        </div>

        <SheetFooter>
          <Button variant="outline" className="gap-2" onClick={onExport} disabled={!diff}>
            <Download size={15} aria-hidden="true" />
            {t('export')}
          </Button>
          <Button variant="outline" onClick={onClose}>
            {t('close')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: 'up' | 'down';
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1 text-body-sm font-semibold tabular-nums text-foreground',
          emphasis === 'up' && 'text-warning',
          emphasis === 'down' && 'text-success',
        )}
      >
        <LtrValue>{value}</LtrValue>
      </dd>
    </div>
  );
}
