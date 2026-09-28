'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
 */
export function PrepareInvoiceDialog({ projectId, installmentId, open, onClose }: PrepareInvoiceDialogProps) {
  const t = useTranslations('commercial.prepare');
  const preview = usePreparePreview(projectId, installmentId, open);

  if (!installmentId) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {preview.isPending ? (
          <SkeletonRegion label={t('loading')} className="mt-4 space-y-3">
            <div className="h-5 w-2/3 animate-pulse rounded-control bg-muted" />
            <div className="h-5 w-1/2 animate-pulse rounded-control bg-muted" />
            <div className="h-16 animate-pulse rounded-control bg-muted" />
          </SkeletonRegion>
        ) : preview.isError ? (
          <div className="mt-4 space-y-3">
            <Alert variant="error" messages={[preview.error.message || t('loadFailed')]} />
            <Button variant="outline" onClick={() => void preview.refetch()}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          <PrepareBody
            key={preview.data.installmentId}
            projectId={projectId}
            installmentId={installmentId}
            preview={preview.data}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PrepareBody({
  projectId,
  installmentId,
  preview,
  onClose,
}: {
  projectId: string;
  installmentId: string;
  preview: CommercialPreparePreviewResponse;
  onClose: () => void;
}) {
  const t = useTranslations('commercial.prepare');
  const locale = useLocale() as 'en';
  const router = useRouter();
  const mutation = usePreparePackage(projectId, installmentId);

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(preview.variations.filter((v) => v.defaultSelected).map((v) => v.variationId)),
  );

  // The preview nulls money for a viewer who cannot see financials.
  const moneyHidden = preview.stageAmount === null;
  const hiddenLabel = t('hiddenAmount');

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totals = moneyHidden
    ? null
    : prepareTotals(
        preview.stageAmount as string,
        preview.variations.filter((v) => selected.has(v.variationId)).map((v) => v.amount),
        preview.taxRate,
      );

  function create() {
    mutation.mutate(
      { selectedVariationIds: [...selected] },
      {
        onSuccess: (result) => {
          onClose();
          router.push(`/projects/${projectId}/commercial/invoices/${result.invoiceId}`);
        },
      },
    );
  }

  return (
    <>
      <div className="mt-4 space-y-5">
        {mutation.isError ? (
          <Alert variant="error" messages={[mutation.error.message || t('createFailed')]} />
        ) : null}

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
                      onChange={() => toggle(variation.variationId)}
                      disabled={mutation.isPending || Boolean(preview.blocker)}
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

      <DialogFooter>
        {preview.blocker ? null : (
          <Button onClick={create} disabled={mutation.isPending}>
            {mutation.isPending ? t('creating') : t('create')}
          </Button>
        )}
        <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
          {preview.blocker ? t('close') : t('cancel')}
        </Button>
      </DialogFooter>
    </>
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
