'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Checkbox,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  MoneyDisplay,
  Notice,
  SkeletonRegion,
} from '@erp/ui';
import type { CommercialPreparePreviewResponse, InstallmentReleasedBy } from '@erp/types';

import { formatDate } from '@/lib/format';

import { usePreparePackage, usePreparePreview } from '../hooks/use-commercial-invoice';
import { formatRate, prepareTotals } from './prepare-invoice-dialog.model';

export interface PrepareInvoiceDialogProps {
  projectId: string;
  /** The payment-schedule stage to invoice. The dialog renders nothing without one. */
  installmentId: string | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Prepare invoice (decision D1): creates the stage's DRAFT invoice — and one per ticked
 * variation — and opens it. Nothing is numbered or posted here; that is Issue, on the invoice
 * page, after the draft has been reviewed.
 *
 * Everything shown comes from `GET …/installments/:id/prepare-preview`: the stage, what releases
 * it, the variations that can ride on it and the server's tax rate. When the server says the
 * stage is blocked, the dialog says why and offers no primary.
 *
 * A `FormDialog` (ADR-039), size `lg`: the stage, a short list of variations and the totals.
 * The create call and the variation ticks live here, above the body, so the dialog's guard can
 * block dismissal mid-create and ask before throwing changed ticks away.
 */
export function PrepareInvoiceDialog({ projectId, installmentId, open, onClose }: PrepareInvoiceDialogProps) {
  const t = useTranslations('commercial.prepare');
  const router = useRouter();
  const preview = usePreparePreview(projectId, installmentId, open);
  const mutation = usePreparePackage(projectId, installmentId ?? '');

  // The user's ticks, remembered against the stage they were made for; until the user changes
  // one, the server's `defaultSelected` stands.
  const [override, setOverride] = useState<{ installmentId: string; ids: Set<string> } | null>(null);

  if (!installmentId) return null;

  const data = preview.isPending || preview.isError ? null : preview.data;
  const defaults = new Set(
    (data?.variations ?? []).filter((v) => v.defaultSelected).map((v) => v.variationId),
  );
  const ownOverride = data && override?.installmentId === data.installmentId ? override.ids : null;
  const selected = ownOverride ?? defaults;
  const dirty = ownOverride !== null && !sameMembers(ownOverride, defaults);

  function toggle(id: string) {
    if (!data) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOverride({ installmentId: data.installmentId, ids: next });
  }

  function close() {
    setOverride(null);
    onClose();
  }

  function create() {
    mutation.mutate(
      { selectedVariationIds: [...selected] },
      {
        onSuccess: (result) => {
          close();
          router.push(`/projects/${projectId}/commercial/invoices/${result.invoiceId}`);
        },
      },
    );
  }

  const blocked = Boolean(data?.blocker);

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (!next ? close() : undefined)}
      title={t('title')}
      subtitle={t('description')}
      size="lg"
      dirty={dirty}
      busy={mutation.isPending}
      closeLabel={t('close')}
    >
      <FormDialogBody>
        {preview.isPending ? (
          <SkeletonRegion label={t('loading')} className="space-y-3">
            <div className="h-5 w-2/3 animate-pulse rounded-control bg-muted" />
            <div className="h-5 w-1/2 animate-pulse rounded-control bg-muted" />
            <div className="h-16 animate-pulse rounded-control bg-muted" />
          </SkeletonRegion>
        ) : preview.isError ? (
          <div className="space-y-3">
            <Alert variant="error" messages={[preview.error.message || t('loadFailed')]} />
            <Button variant="outline" onClick={() => void preview.refetch()}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          <PrepareBody
            preview={preview.data}
            selected={selected}
            onToggle={toggle}
            isPending={mutation.isPending}
            error={mutation.isError ? mutation.error : null}
          />
        )}
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={mutation.isPending}>
            {blocked ? t('close') : t('cancel')}
          </Button>
        </FormDialogClose>
        {data && !blocked ? (
          <Button type="button" onClick={create} disabled={mutation.isPending}>
            {mutation.isPending ? t('creating') : t('create')}
          </Button>
        ) : null}
      </FormDialogFooter>
    </FormDialog>
  );
}

function sameMembers(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function PrepareBody({
  preview,
  selected,
  onToggle,
  isPending,
  error,
}: {
  preview: CommercialPreparePreviewResponse;
  selected: Set<string>;
  onToggle: (variationId: string) => void;
  isPending: boolean;
  error: Error | null;
}) {
  const t = useTranslations('commercial.prepare');
  const locale = useLocale() as 'en';

  // The preview nulls money for a viewer who cannot see financials.
  const moneyHidden = preview.stageAmount === null;
  const hiddenLabel = t('hiddenAmount');

  const totals = moneyHidden
    ? null
    : prepareTotals(
        preview.stageAmount as string,
        preview.variations.filter((v) => selected.has(v.variationId)).map((v) => v.amount),
        preview.taxRate,
      );

  return (
    <div className="space-y-5">
      {error ? <Alert variant="error" messages={[error.message || t('createFailed')]} /> : null}

      <dl className="space-y-3 text-body-sm">
        <div>
          <dt className="text-caption text-muted-foreground">{t('stage')}</dt>
          <dd className="font-medium text-foreground">{preview.stageName}</dd>
          <dd className="text-caption text-muted-foreground">
            {t('stagePosition', {
              n: preview.stageNumber,
              count: preview.stageCount,
              percent: formatRate(preview.percentage),
            })}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-muted-foreground">{t('releasedBy')}</dt>
          <dd className="text-foreground">
            <ReleasedBy releasedBy={preview.releasedBy} locale={locale} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">{t('stageAmount')}</dt>
          <dd className="font-medium text-foreground">
            <MoneyDisplay value={preview.stageAmount} hidden={moneyHidden} hiddenLabel={hiddenLabel} />
          </dd>
        </div>
      </dl>

      {preview.blocker ? (
        <Notice tone="attention" title={t('blockedTitle')}>
          {t(`blocker.${preview.blocker}`)}
        </Notice>
      ) : null}

      {preview.variations.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-body-sm font-semibold text-foreground">{t('variationsTitle')}</legend>
          <p className="text-caption text-muted-foreground">{t('variationsHint')}</p>
          <ul className="divide-y divide-border rounded-panel border border-border">
            {preview.variations.map((variation) => {
              const id = `prep-vo-${variation.variationId}`;
              const reduction = variation.treatment === 'STAGE_REDUCTION';
              return (
                <li key={variation.variationId} className="flex min-h-11 items-start gap-3 p-3">
                  <Checkbox
                    id={id}
                    checked={selected.has(variation.variationId)}
                    onChange={() => onToggle(variation.variationId)}
                    disabled={isPending || Boolean(preview.blocker)}
                    className="mt-0.5"
                  />
                  <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-body-sm text-foreground">
                        <span className="font-mono text-caption text-muted-foreground">{variation.reference}</span>{' '}
                        {variation.title}
                      </span>
                      <span className="block text-caption text-muted-foreground">
                        {reduction ? t('treatment.STAGE_REDUCTION') : t('treatment.INVOICE')}
                      </span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-body-sm text-foreground">
                      <MoneyDisplay value={variation.amount} hidden={variation.amount === null} hiddenLabel={hiddenLabel} />
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}

      {totals ? (
        <dl className="space-y-1.5 rounded-panel bg-surface-subtle px-4 py-3 text-body-sm tabular-nums">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{t('subtotal')}</dt>
            <dd className="text-foreground">
              <MoneyDisplay value={totals.subtotal} />
            </dd>
          </div>
          {totals.tax !== null && preview.taxRate ? (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">{t('tax', { rate: formatRate(preview.taxRate) })}</dt>
              <dd className="text-foreground">
                <MoneyDisplay value={totals.tax} />
              </dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-1.5 font-semibold">
            <dt className="text-foreground">{t('total')}</dt>
            <dd className="text-foreground" data-testid="prepare-total">
              <MoneyDisplay value={totals.total} />
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-body-sm text-muted-foreground">{t('totalsHidden')}</p>
      )}

      {preview.blocker ? null : <p className="text-caption text-muted-foreground">{t('draftNote')}</p>}
    </div>
  );
}

function ReleasedBy({ releasedBy, locale }: { releasedBy: InstallmentReleasedBy; locale: 'en' }) {
  const t = useTranslations('commercial.prepare');
  if (releasedBy.kind === 'ADVANCE') return <>{t('released.advance')}</>;
  if (releasedBy.kind === 'DATE') {
    const date = formatDate(releasedBy.date, locale);
    return <>{date ? t('released.date', { date }) : t('released.dateNotSet')}</>;
  }
  const name = [releasedBy.milestoneCode, releasedBy.milestoneName].filter(Boolean).join(' ');
  const verified = formatDate(releasedBy.verifiedAt, locale);
  return (
    <>
      {name || t('released.noMilestone')}
      <span className="block text-caption text-muted-foreground">
        {verified ? t('released.verified', { date: verified }) : t('released.notVerified')}
      </span>
    </>
  );
}
