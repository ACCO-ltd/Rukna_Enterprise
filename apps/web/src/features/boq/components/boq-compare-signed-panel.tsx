'use client';

import type { BoqCompareToSignedResponse } from '@erp/types';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  LtrValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';

/**
 * The compare-to-signed lens (R11 concept D, on demand).
 *
 * The R10 diff is the live operational version against the frozen as-committed SNAPSHOT — the
 * meaningful "what changed since the client signed" question. Every change carries a `changeClass`
 * so the reader can separate "we tidied the document" (MONEY_NEUTRAL) from "we changed what the
 * client owes" (VALUE_CHANGING); this panel groups on exactly that. Totals are `canViewCost`-gated
 * decimal strings rendered verbatim — never re-summed.
 *
 * Implemented as an overlay dialog rather than a route (Decision 6). A future iteration can render
 * it as an in-grid gutter lens; the grouped-by-class summary is the load-bearing part today.
 */
export function BoqCompareSignedPanel({
  data,
  currency,
  canViewCost,
  isPending,
  isError,
  onClose,
}: {
  data: BoqCompareToSignedResponse | undefined;
  currency: string;
  canViewCost: boolean;
  isPending: boolean;
  isError: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('platform.boq.compareToSigned');
  const locale = useLocale() as 'en' | 'ar';

  const money = (v: string | null): string | null => formatMoney(v, currency, locale);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogTitle>{t('heading')}</DialogTitle>

        {isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : isError ? (
          <Alert variant="error" messages={[t('loadFailed')]} />
        ) : !data || !data.available ? (
          <Alert variant="info" messages={[t('unavailable')]} />
        ) : (
          <div className="space-y-4">
            {/* signed → live · Δ */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-border bg-surface-subtle px-4 py-3">
              <span className="inline-flex items-center gap-2">
                <Badge tone="neutral">{t('classNeutral')}</Badge>
                <span className="text-body-sm text-muted-foreground">
                  {t('moneyNeutral', { count: data.moneyNeutralCount })}
                </span>
              </span>
              <span className="inline-flex items-center gap-2">
                <Badge tone="warning">{t('classValue')}</Badge>
                <span className="text-body-sm text-muted-foreground">
                  {t('valueChanging', { count: data.valueChangingCount })}
                </span>
              </span>
              {canViewCost && data.inContractDelta ? (
                <span className="ms-auto text-body-sm font-medium tabular-nums text-foreground">
                  {t('delta', { amount: money(data.inContractDelta) ?? '' })}
                </span>
              ) : null}
            </div>

            {data.changes.length === 0 ? (
              <Alert variant="info" messages={[t('noChanges')]} />
            ) : (
              <TableScroll>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('classValue')}</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Description</TableHead>
                      {canViewCost ? (
                        <TableHead numeric>Δ</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.changes.map((change) => (
                      <TableRow key={`${change.leftNodeId ?? ''}-${change.rightNodeId ?? ''}-${change.code}`}>
                        <TableCell>
                          <Badge tone={change.changeClass === 'VALUE_CHANGING' ? 'warning' : 'neutral'}>
                            {change.changeClass === 'VALUE_CHANGING'
                              ? t('classValue')
                              : t('classNeutral')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <LtrValue className="font-mono text-caption">{change.code}</LtrValue>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">{change.description}</TableCell>
                        {canViewCost ? (
                          <TableCell numeric>
                            {change.amountDelta ? (
                              <LtrValue className="tabular-nums">
                                {money(change.amountDelta)}
                              </LtrValue>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScroll>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('exit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
