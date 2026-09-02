'use client';

import * as React from 'react';
import { CalendarClock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  DatePicker,
  Label,
  SectionHeader,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
  Skeleton,
  Textarea,
  useToast,
} from '@erp/ui';
import type { ExtensionOfTimeResponse, VariationOrderListItem } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { EmptyState } from '@/components/empty-state';
import { formatDate } from '@/lib/format';
import { usePermissions } from '@/features/auth/permissions/can';

import { useExtensionsOfTime, useGrantExtensionOfTime } from '../hooks/use-commercial';
import { variationStatusTone } from '../presentation';

/**
 * Extension of Time (ADR-026 Phase 4). Surfaces the contract's current completion date, the full
 * EoT history (previous → new date, granted days, reason, cited VOs, who/when), and a "Record
 * extension of time" primary that opens the grant form.
 *
 * The copy makes the doctrine explicit: moving the completion date is an EXPLICIT human act. A
 * VO's proposed time impact is shown in the create form purely as justification the actor may
 * cite; it is never auto-applied on VO approval (CONST-VAR-009).
 */
export function ExtensionOfTimeSection({
  contractId,
  projectId,
  variations,
}: {
  contractId: string;
  projectId: string;
  variations: VariationOrderListItem[];
}) {
  const t = useTranslations('commercial.eot');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();
  const query = useExtensionsOfTime(contractId);
  const [open, setOpen] = React.useState(false);

  const canManage = can('manage:contract');

  return (
    <section className="space-y-3">
      <SectionHeader title={t('title')}>
        {canManage ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            {t('record')}
          </Button>
        ) : null}
      </SectionHeader>

      <p className="text-caption text-muted-foreground">{t('explainer')}</p>

      {query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : query.isError ? (
        <div className="rounded-panel border border-border bg-surface p-4">
          <p className="text-body-sm text-muted-foreground">{t('loadFailed')}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-panel border border-border bg-surface px-4 py-3">
            <span className="text-caption text-muted-foreground">{t('currentEndDate')}</span>
            <p className="mt-0.5 text-h3 font-semibold tabular-nums text-foreground">
              {query.data.currentEndDate
                ? formatDate(query.data.currentEndDate, locale)
                : t('noEndDate')}
            </p>
          </div>

          {query.data.extensions.length === 0 ? (
            <EmptyState
              icon={<CalendarClock size={22} aria-hidden="true" />}
              variant="page"
              title={t('emptyTitle')}
              description={t('emptyHint')}
            />
          ) : (
            <ul className="space-y-2">
              {query.data.extensions.map((eot) => (
                <ExtensionRow key={eot.id} eot={eot} locale={locale} />
              ))}
            </ul>
          )}
        </>
      )}

      {open ? (
        <GrantExtensionSheet
          contractId={contractId}
          projectId={projectId}
          variations={variations}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </section>
  );
}

function ExtensionRow({
  eot,
  locale,
}: {
  eot: ExtensionOfTimeResponse;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('commercial.eot');

  return (
    <li className="rounded-panel border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-body-sm font-medium tabular-nums text-foreground">
          {eot.previousEndDate ? formatDate(eot.previousEndDate, locale) : t('noEndDate')}
          {' → '}
          {formatDate(eot.newEndDate, locale)}
        </p>
        {eot.grantedDays !== null ? (
          <Badge tone={eot.grantedDays >= 0 ? 'info' : 'warning'}>
            {t('grantedDays', { n: eot.grantedDays })}
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 text-body-sm text-foreground">{eot.reason}</p>
      {eot.citedVariationOrders.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-caption text-muted-foreground">{t('cited')}</span>
          {eot.citedVariationOrders.map((vo) => (
            <Badge key={vo.id} tone={variationStatusTone(vo.status)}>
              {vo.reference}
            </Badge>
          ))}
        </div>
      ) : null}
      <p className="mt-1.5 text-caption text-muted-foreground">
        {t('grantedMeta', {
          date: formatDate(eot.grantedAt, locale) ?? '',
        })}
      </p>
    </li>
  );
}

function GrantExtensionSheet({
  contractId,
  projectId,
  variations,
  open,
  onOpenChange,
}: {
  contractId: string;
  projectId: string;
  variations: VariationOrderListItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('commercial.eot');
  const tVo = useTranslations('commercial.variations');
  const tCommon = useTranslations('common');
  const { toast } = useToast();
  const grant = useGrantExtensionOfTime(contractId, projectId);

  // Mounted only while open (see ExtensionOfTimeSection), so state starts fresh each time —
  // no setState-in-effect reset needed.
  const [newEndDate, setNewEndDate] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [cited, setCited] = React.useState<string[]>([]);

  const canSave = newEndDate !== '' && reason.trim() !== '' && !grant.isPending;

  function toggleCite(id: string) {
    setCited((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    grant.mutate(
      {
        newEndDate,
        reason: reason.trim(),
        variationOrderIds: cited.length > 0 ? cited : undefined,
      },
      {
        onSuccess: () => {
          toast({ title: t('toast.granted'), tone: 'success' });
          onOpenChange(false);
        },
        onError: (error) =>
          toast({ title: errorMessage(error, t('toast.grantFailed')), tone: 'error' }),
      },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby="eot-desc">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border px-5 py-4">
            <SheetTitle>{t('grantTitle')}</SheetTitle>
            <SheetDescription id="eot-desc">{t('grantSubtitle')}</SheetDescription>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="eot-date">{t('newEndDate')}</Label>
              <DatePicker
                id="eot-date"
                value={newEndDate}
                onChange={(value) => setNewEndDate(value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="eot-reason">{t('reason')}</Label>
              <Textarea
                id="eot-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                rows={3}
                required
              />
            </div>

            <div className="space-y-2">
              <span className="text-body-sm font-medium text-foreground">{t('citeTitle')}</span>
              <p className="text-caption text-muted-foreground">{t('citeHint')}</p>
              {variations.length === 0 ? (
                <p className="text-caption italic text-muted-foreground">{t('noVariations')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {variations.map((vo) => (
                    <li key={vo.id}>
                      <label className="flex cursor-pointer items-start gap-2.5 rounded-control border border-border bg-surface-subtle px-3 py-2">
                        <input
                          type="checkbox"
                          checked={cited.includes(vo.id)}
                          onChange={() => toggleCite(vo.id)}
                          className="mt-0.5 size-4 accent-brand-primary"
                        />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <code className="font-mono text-caption text-muted-foreground">
                              {vo.reference}
                            </code>
                            <Badge tone={variationStatusTone(vo.status)}>
                              {tVo(`status.${vo.status}`)}
                            </Badge>
                          </span>
                          <span className="mt-0.5 block truncate text-body-sm text-foreground">
                            {vo.title}
                          </span>
                          {vo.proposedTimeImpactDays !== null ? (
                            <span className="text-caption text-muted-foreground">
                              {t('proposedImpact', { n: vo.proposedTimeImpactDays })}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <SheetFooter>
            <Button type="submit" disabled={!canSave}>
              {grant.isPending ? tCommon('saving') : t('grantConfirm')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={grant.isPending}
            >
              {tCommon('cancel')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}
