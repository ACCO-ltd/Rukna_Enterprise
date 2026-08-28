'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  DefinitionList,
  DefinitionRow,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
  Skeleton,
  Textarea,
  useToast,
} from '@erp/ui';
import type { VariationOrderResponse } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { usePermissions } from '@/features/auth/permissions/can';

import {
  useClientApproveVariation,
  useInternalApproveVariation,
  useRejectVariation,
  useSubmitVariation,
  useVariation,
  useWithdrawVariation,
} from '../hooks/use-commercial';
import { variationStatusTone } from '../presentation';

/**
 * VariationOrder detail, in a drawer so the list stays behind it (the commercial pattern for a
 * lifecycle command). Every action here is gated twice: by the VO's real status (only the
 * transitions the state machine allows appear) and by permission (`manage`/`approve:contract`).
 * There is at most one PRIMARY per state — the obvious next action — with regressive actions
 * (reject/withdraw) rendered as muted, outline controls. A terminal VO is read-only.
 *
 * The screen renders only server figures: the net price is `VariationOrderResponse.netPrice`, and
 * every transition re-reads from the server on success. Governance (409) and client-approval (400)
 * failures surface as toasts, never a crash.
 */
export function VariationDetailSheet({
  variationId,
  contractId,
  projectId,
  currency,
  open,
  onOpenChange,
}: {
  variationId: string | null;
  contractId: string;
  projectId: string;
  currency: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('commercial.variations');
  const query = useVariation(open ? variationId : null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby="vo-detail-desc" className="sm:w-[520px]">
        {query.isPending ? (
          <div className="space-y-3 p-5" role="status" aria-live="polite">
            <span className="sr-only">{t('detail.loading')}</span>
            <Skeleton className="h-8 w-2/3" aria-hidden="true" />
            <Skeleton className="h-24 w-full" aria-hidden="true" />
            <Skeleton className="h-40 w-full" aria-hidden="true" />
          </div>
        ) : query.isError || !query.data ? (
          <div className="p-5">
            <SheetTitle>{t('detail.loadFailed')}</SheetTitle>
            <SheetDescription id="vo-detail-desc" className="mt-1">
              {t('detail.loadFailedHint')}
            </SheetDescription>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>
              {t('detail.retry')}
            </Button>
          </div>
        ) : (
          // Keyed by status so a transition remounts the body fresh — inline decision forms
          // (reject/withdraw/client-approve) reset without a setState-in-effect.
          <DetailBody
            key={query.data.status}
            variation={query.data}
            contractId={contractId}
            projectId={projectId}
            currency={currency}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({
  variation,
  contractId,
  projectId,
  currency,
  onDone,
}: {
  variation: VariationOrderResponse;
  contractId: string;
  projectId: string;
  currency: string | null;
  onDone: () => void;
}) {
  const t = useTranslations('commercial.variations');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();
  const { toast } = useToast();

  const canManage = can('manage:contract');
  const canApprove = can('approve:contract');

  const submit = useSubmitVariation(variation.id, contractId, projectId);
  const internalApprove = useInternalApproveVariation(variation.id, contractId, projectId);
  const clientApprove = useClientApproveVariation(variation.id, contractId, projectId);
  const reject = useRejectVariation(variation.id, contractId, projectId);
  const withdraw = useWithdrawVariation(variation.id, contractId, projectId);

  const busy =
    submit.isPending ||
    internalApprove.isPending ||
    clientApprove.isPending ||
    reject.isPending ||
    withdraw.isPending;

  // Reason capture for reject/withdraw and the client-approval form are inline sub-states so the
  // drawer never navigates away mid-decision.
  const [mode, setMode] = React.useState<'view' | 'reject' | 'withdraw' | 'client-approve'>('view');
  const [reason, setReason] = React.useState('');
  const [clientRef, setClientRef] = React.useState('');
  const [clientNote, setClientNote] = React.useState('');

  function onError(fallbackKey: string) {
    return (error: unknown) =>
      toast({ title: errorMessage(error, t(fallbackKey)), tone: 'error' });
  }

  function runSubmit() {
    submit.mutate(undefined, {
      onSuccess: () => toast({ title: t('toast.submitted'), tone: 'success' }),
      onError: onError('toast.submitFailed'),
    });
  }

  function runInternalApprove() {
    internalApprove.mutate(undefined, {
      onSuccess: () => toast({ title: t('toast.internalApproved'), tone: 'success' }),
      // A 409 here means DOA governance requires a workflow approval; a 422 means it is not
      // configured. Either way the state has not moved — surface the server's message.
      onError: onError('toast.internalApproveFailed'),
    });
  }

  function runClientApprove() {
    if (clientRef.trim() === '') return;
    clientApprove.mutate(
      { clientApprovalReference: clientRef.trim(), note: clientNote.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: t('toast.clientApproved'), tone: 'success' });
          setMode('view');
        },
        onError: onError('toast.clientApproveFailed'),
      },
    );
  }

  function runReject() {
    if (reason.trim() === '') return;
    reject.mutate(reason.trim(), {
      onSuccess: () => {
        toast({ title: t('toast.rejected'), tone: 'success' });
        setMode('view');
      },
      onError: onError('toast.rejectFailed'),
    });
  }

  function runWithdraw() {
    withdraw.mutate(reason.trim() || undefined, {
      onSuccess: () => {
        toast({ title: t('toast.withdrawn'), tone: 'success' });
        setMode('view');
      },
      onError: onError('toast.withdrawFailed'),
    });
  }

  const money = (value: string | number | null) =>
    formatMoney(value, currency, locale) ?? t('detail.notSet');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <code className="font-mono text-caption text-muted-foreground">{variation.reference}</code>
          <Badge tone={variationStatusTone(variation.status)}>
            {t(`status.${variation.status}`)}
          </Badge>
        </div>
        <SheetTitle className="mt-1.5">{variation.title}</SheetTitle>
        <SheetDescription id="vo-detail-desc" className="mt-1">
          {t('detail.subtitle')}
        </SheetDescription>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {variation.description ? (
          <p className="text-body-sm text-foreground">{variation.description}</p>
        ) : null}

        <section>
          <h3 className="mb-2 text-body-sm font-semibold text-foreground">
            {t('detail.linesTitle')}
          </h3>
          {variation.lines.length === 0 ? (
            <p className="text-caption text-muted-foreground">{t('detail.noLines')}</p>
          ) : (
            <ul className="divide-y divide-border/70 rounded-control border border-border">
              {variation.lines.map((line) => (
                <li key={line.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-body-sm text-foreground">{line.description}</p>
                    <p className="text-caption tabular-nums text-muted-foreground">
                      {line.quantity} × {money(line.unitRate)}
                    </p>
                  </div>
                  <span className="shrink-0 text-body-sm font-medium tabular-nums text-foreground">
                    {money(line.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <DefinitionList>
          <DefinitionRow label={t('detail.netPrice')} numeric>
            {money(variation.netPrice)}
          </DefinitionRow>
          <DefinitionRow label={t('detail.timeImpact')} numeric emptyText={t('detail.notSet')}>
            {variation.proposedTimeImpactDays === null
              ? undefined
              : t('detail.days', { n: variation.proposedTimeImpactDays })}
          </DefinitionRow>
          {variation.submittedAt ? (
            <DefinitionRow label={t('detail.submitted')}>
              {formatDate(variation.submittedAt, locale)}
            </DefinitionRow>
          ) : null}
          {variation.internalApprovedAt ? (
            <DefinitionRow label={t('detail.internalApproved')}>
              {formatDate(variation.internalApprovedAt, locale)}
            </DefinitionRow>
          ) : null}
          {variation.clientApprovedAt ? (
            <DefinitionRow label={t('detail.clientApproved')}>
              {formatDate(variation.clientApprovedAt, locale)}
            </DefinitionRow>
          ) : null}
          {variation.clientApprovalReference ? (
            <DefinitionRow label={t('detail.clientRef')}>
              {variation.clientApprovalReference}
            </DefinitionRow>
          ) : null}
          {variation.reason ? (
            <DefinitionRow label={t('detail.reason')}>{variation.reason}</DefinitionRow>
          ) : null}
        </DefinitionList>

        {/* Inline decision forms */}
        {mode === 'client-approve' ? (
          <section className="space-y-3 rounded-control border border-border bg-surface-subtle p-3">
            <h3 className="text-body-sm font-semibold text-foreground">
              {t('detail.clientApproveTitle')}
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="vo-client-ref">{t('detail.clientRefField')}</Label>
              <Input
                id="vo-client-ref"
                value={clientRef}
                onChange={(e) => setClientRef(e.target.value)}
                maxLength={255}
                required
              />
              <p className="text-caption text-muted-foreground">{t('detail.clientRefHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vo-client-note">{t('detail.noteField')}</Label>
              <Textarea
                id="vo-client-note"
                value={clientNote}
                onChange={(e) => setClientNote(e.target.value)}
                maxLength={2000}
                rows={2}
              />
            </div>
          </section>
        ) : null}

        {mode === 'reject' || mode === 'withdraw' ? (
          <section className="space-y-3 rounded-control border border-border bg-surface-subtle p-3">
            <h3 className="text-body-sm font-semibold text-foreground">
              {mode === 'reject' ? t('detail.rejectTitle') : t('detail.withdrawTitle')}
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="vo-reason">
                {mode === 'reject' ? t('detail.rejectReason') : t('detail.withdrawReason')}
              </Label>
              <Textarea
                id="vo-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={2}
                required={mode === 'reject'}
              />
            </div>
          </section>
        ) : null}
      </div>

      <SheetFooter>
        <Actions
          status={variation.status}
          canManage={canManage}
          canApprove={canApprove}
          busy={busy}
          mode={mode}
          setMode={setMode}
          onSubmit={runSubmit}
          onInternalApprove={runInternalApprove}
          onClientApprove={runClientApprove}
          onReject={runReject}
          onWithdraw={runWithdraw}
          onClose={onDone}
          canConfirmClientApprove={clientRef.trim() !== ''}
          canConfirmReject={reason.trim() !== ''}
        />
      </SheetFooter>
    </div>
  );
}

/**
 * Renders exactly the transitions the current status + permission allow — never a disabled
 * button for an action the state does not offer. One primary (the obvious next step); reject and
 * withdraw are the muted, outline regressive actions.
 */
function Actions({
  status,
  canManage,
  canApprove,
  busy,
  mode,
  setMode,
  onSubmit,
  onInternalApprove,
  onClientApprove,
  onReject,
  onWithdraw,
  onClose,
  canConfirmClientApprove,
  canConfirmReject,
}: {
  status: VariationOrderResponse['status'];
  canManage: boolean;
  canApprove: boolean;
  busy: boolean;
  mode: 'view' | 'reject' | 'withdraw' | 'client-approve';
  setMode: (mode: 'view' | 'reject' | 'withdraw' | 'client-approve') => void;
  onSubmit: () => void;
  onInternalApprove: () => void;
  onClientApprove: () => void;
  onReject: () => void;
  onWithdraw: () => void;
  onClose: () => void;
  canConfirmClientApprove: boolean;
  canConfirmReject: boolean;
}) {
  const t = useTranslations('commercial.variations');
  const tCommon = useTranslations('common');

  // Confirmation footers for the inline decision forms.
  if (mode === 'client-approve') {
    return (
      <>
        <Button onClick={onClientApprove} disabled={busy || !canConfirmClientApprove}>
          {t('actions.confirmClientApprove')}
        </Button>
        <Button variant="outline" onClick={() => setMode('view')} disabled={busy}>
          {tCommon('cancel')}
        </Button>
      </>
    );
  }
  if (mode === 'reject') {
    return (
      <>
        <Button variant="destructive" onClick={onReject} disabled={busy || !canConfirmReject}>
          {t('actions.confirmReject')}
        </Button>
        <Button variant="outline" onClick={() => setMode('view')} disabled={busy}>
          {tCommon('cancel')}
        </Button>
      </>
    );
  }
  if (mode === 'withdraw') {
    return (
      <>
        <Button variant="destructive" onClick={onWithdraw} disabled={busy}>
          {t('actions.confirmWithdraw')}
        </Button>
        <Button variant="outline" onClick={() => setMode('view')} disabled={busy}>
          {tCommon('cancel')}
        </Button>
      </>
    );
  }

  // Status-gated primary + regressive actions.
  switch (status) {
    case 'DRAFT':
      return (
        <>
          {canManage ? (
            <Button onClick={onSubmit} disabled={busy}>
              {t('actions.submit')}
            </Button>
          ) : null}
          {canManage ? (
            <Button variant="outline" onClick={() => setMode('withdraw')} disabled={busy}>
              {t('actions.withdraw')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('actions.close')}
          </Button>
        </>
      );
    case 'PENDING_INTERNAL':
      return (
        <>
          {canApprove ? (
            <Button onClick={onInternalApprove} disabled={busy}>
              {t('actions.internalApprove')}
            </Button>
          ) : null}
          {canApprove ? (
            <Button variant="outline" onClick={() => setMode('reject')} disabled={busy}>
              {t('actions.reject')}
            </Button>
          ) : null}
          {canManage ? (
            <Button variant="outline" onClick={() => setMode('withdraw')} disabled={busy}>
              {t('actions.withdraw')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('actions.close')}
          </Button>
        </>
      );
    case 'INTERNAL_APPROVED':
      return (
        <>
          {canApprove ? (
            <Button onClick={() => setMode('client-approve')} disabled={busy}>
              {t('actions.clientApprove')}
            </Button>
          ) : null}
          {canApprove ? (
            <Button variant="outline" onClick={() => setMode('reject')} disabled={busy}>
              {t('actions.reject')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('actions.close')}
          </Button>
        </>
      );
    // CLIENT_APPROVED / REJECTED / WITHDRAWN are terminal — read-only.
    default:
      return (
        <Button variant="outline" onClick={onClose} disabled={busy}>
          {t('actions.close')}
        </Button>
      );
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}
