'use client';

import * as React from 'react';
import { CalendarClock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, Button, CheckboxField, DatePicker, EmptyState, FormDialog, FormDialogBody, FormDialogClose, FormDialogFooter, Label, SectionHeader, Skeleton, Textarea, useToast, StatusPill } from '@erp/ui';
import type { ExtensionOfTimeResponse, VariationOrderListItem } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { statusTone } from '@/lib/status-registry';
import { usePermissions } from '@/features/auth/permissions/can';

import { useExtensionsOfTime, useGrantExtensionOfTime } from '../hooks/use-commercial';

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
          <Button size="sm" className="min-h-11 sm:min-h-0" onClick={() => setOpen(true)}>
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
        <GrantExtensionDialog
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
          <Badge tone={eot.grantedDays >= 0 ? 'neutral' : 'attention'}>
            {t('grantedDays', { n: eot.grantedDays })}
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 text-body-sm text-foreground">{eot.reason}</p>
      {eot.citedVariationOrders.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-caption text-muted-foreground">{t('cited')}</span>
          {eot.citedVariationOrders.map((vo) => (
            <StatusPill key={vo.id} tone={statusTone(vo.status, 'variation')}>
              {vo.reference}
            </StatusPill>
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

/** Record an extension of time — a `FormDialog` (ADR-039), size `md`: three fields. */
function GrantExtensionDialog({
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

  const ready = newEndDate !== '' && reason.trim() !== '';
  const canSave = ready && !grant.isPending;
  const dirty = newEndDate !== '' || reason !== '' || cited.length > 0;

  function toggleCite(id: string) {
    setCited((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleSubmit() {
    if (!canSave) return;
    grant.mutate(
      {
        newEndDate,
        reason: reason.trim(),
        variationOrderIds: cited.length > 0 ? cited : undefined,
      },
      {
        // The success toast comes from the mutation's feedback meta.
        onSuccess: () => onOpenChange(false),
        onError: (error) =>
          toast({ title: errorMessage(error, t('toast.grantFailed')), tone: 'error' }),
      },
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('grantTitle')}
      subtitle={t('grantSubtitle')}
      size="md"
      dirty={dirty}
      busy={grant.isPending}
      onSubmit={handleSubmit}
    >
      <FormDialogBody>
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
                  <CheckboxField
                    id={`eot-vo-${vo.id}`}
                    className="rounded-control border border-border bg-surface-subtle px-3"
                    label={
                      <span className="flex flex-wrap items-center gap-2">
                        <code className="font-mono text-caption text-muted-foreground">
                          {vo.reference}
                        </code>
                        <StatusPill tone={statusTone(vo.status, 'variation')}>
                          {tVo(`status.${vo.status}`)}
                        </StatusPill>
                      </span>
                    }
                    description={
                      <>
                        <span className="block truncate text-body-sm text-foreground">
                          {vo.title}
                        </span>
                        {vo.proposedTimeImpactDays !== null ? (
                          <span className="block text-caption text-muted-foreground">
                            {t('proposedImpact', { n: vo.proposedTimeImpactDays })}
                          </span>
                        ) : null}
                      </>
                    }
                    checked={cited.includes(vo.id)}
                    onChange={() => toggleCite(vo.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={grant.isPending}>
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" disabled={!ready} loading={grant.isPending} loadingText={tCommon('saving')}>
          {t('grantConfirm')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}
