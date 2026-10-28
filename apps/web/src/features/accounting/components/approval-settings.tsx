'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, FormGroup, MoneyInput, Notice, SwitchField } from '@erp/ui';
import type { FinanceApprovalSettings } from '@erp/types';

import { LoadError } from '@/components/load-error';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';

import { useApprovalSettings, useUpdateApprovalSettings } from '../hooks/use-accounting';

/**
 * ADR-046 §8 — Finance → Setup & close → Approval rules. The approvals a small finance team may
 * switch on as it grows, each off by default except the payment limit (the ADR-022 lowest band).
 * Read by everyone who raises those documents; changed with `manage:accounting`.
 */
export function ApprovalSettingsPanel() {
  const t = useTranslations('accounting.approvalSettings');
  const settings = useApprovalSettings();
  if (settings.isError) return <LoadError message={t('loadFailed')} onRetry={() => void settings.refetch()} />;
  if (!settings.data) return <p className="text-body-sm text-muted-foreground">{t('loading')}</p>;
  return <ApprovalSettingsForm key={JSON.stringify(settings.data)} saved={settings.data} />;
}

interface Draft {
  invoiceOn: boolean;
  invoiceAbove: string;
  billOn: boolean;
  billAbove: string;
  autoPostToleratedBills: boolean;
  paymentOn: boolean;
  paymentUpTo: string;
}

const toDraft = (s: FinanceApprovalSettings): Draft => ({
  invoiceOn: s.invoiceApprovalAbove !== null,
  invoiceAbove: s.invoiceApprovalAbove ?? '',
  billOn: s.billApprovalAbove !== null,
  billAbove: s.billApprovalAbove ?? '',
  autoPostToleratedBills: s.autoPostToleratedBills,
  paymentOn: Number(s.paymentAutoApproveUpTo) > 0,
  paymentUpTo: Number(s.paymentAutoApproveUpTo) > 0 ? s.paymentAutoApproveUpTo : '1000.00',
});

const amountOk = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());

function ApprovalSettingsForm({ saved }: { saved: FinanceApprovalSettings }) {
  const t = useTranslations('accounting.approvalSettings');
  const { can } = usePermissions();
  const mayManage = can(ACCOUNTING_PERMISSIONS.manageChart);
  const save = useUpdateApprovalSettings();
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved));
  const [attempted, setAttempted] = useState(false);
  const patch = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved));
  const disabled = !mayManage || save.isPending;

  const errors = {
    invoice: draft.invoiceOn && !amountOk(draft.invoiceAbove) ? t('amountInvalid') : undefined,
    bill: draft.billOn && !amountOk(draft.billAbove) ? t('amountInvalid') : undefined,
    payment: draft.paymentOn && !amountOk(draft.paymentUpTo) ? t('amountInvalid') : undefined,
  };
  const shown = (e: string | undefined) => (attempted ? e : undefined);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (errors.invoice || errors.bill || errors.payment) return;
    save.mutate({
      invoiceApprovalAbove: draft.invoiceOn ? draft.invoiceAbove.trim() : null,
      billApprovalAbove: draft.billOn ? draft.billAbove.trim() : null,
      autoPostToleratedBills: draft.autoPostToleratedBills,
      paymentAutoApproveUpTo: draft.paymentOn ? draft.paymentUpTo.trim() : '0',
    });
  }

  const saveError = save.isError ? (save.error instanceof ApiError ? save.error.message : t('saveFailed')) : null;

  return (
    <form className="max-w-3xl space-y-8" onSubmit={submit} aria-label={t('title')} noValidate>
      <header className="space-y-1">
        <h2 className="text-h2 font-semibold text-foreground">{t('title')}</h2>
        <p className="max-w-prose text-body-sm text-muted-foreground">{t('description')}</p>
      </header>
      {!mayManage ? <Notice tone="attention">{t('readOnly')}</Notice> : null}
      {saveError ? <Alert variant="error" messages={[saveError]} /> : null}

      <FormGroup title={t('invoicesTitle')} description={t('invoicesDescription')}>
        <div className="sm:col-span-2">
          <SwitchField id="approval-invoice-on" label={t('invoiceSwitch')} description={t('invoiceSwitchHint')} checked={draft.invoiceOn} disabled={disabled} onCheckedChange={(invoiceOn) => patch({ invoiceOn })} />
        </div>
        {draft.invoiceOn ? (
          <FormField htmlFor="approval-invoice-above" label={t('invoiceAbove')} error={shown(errors.invoice)}>
            <MoneyInput id="approval-invoice-above" value={draft.invoiceAbove} disabled={disabled} onValueChange={(invoiceAbove) => patch({ invoiceAbove })} />
          </FormField>
        ) : null}
      </FormGroup>

      <FormGroup title={t('billsTitle')} description={t('billsDescription')}>
        <div className="sm:col-span-2 space-y-4">
          <SwitchField id="approval-bill-on" label={t('billSwitch')} description={t('billSwitchHint')} checked={draft.billOn} disabled={disabled} onCheckedChange={(billOn) => patch({ billOn })} />
          {draft.billOn ? (
            <FormField htmlFor="approval-bill-above" label={t('billAbove')} error={shown(errors.bill)} className="max-w-xs">
              <MoneyInput id="approval-bill-above" value={draft.billAbove} disabled={disabled} onValueChange={(billAbove) => patch({ billAbove })} />
            </FormField>
          ) : null}
          <SwitchField id="approval-tolerated" label={t('toleratedSwitch')} description={t('toleratedHint')} checked={draft.autoPostToleratedBills} disabled={disabled} onCheckedChange={(autoPostToleratedBills) => patch({ autoPostToleratedBills })} />
        </div>
      </FormGroup>

      <FormGroup title={t('paymentsTitle')} description={t('paymentsDescription')}>
        <div className="sm:col-span-2">
          <SwitchField id="approval-payment-on" label={t('paymentSwitch')} description={t('paymentSwitchHint')} checked={draft.paymentOn} disabled={disabled} onCheckedChange={(paymentOn) => patch({ paymentOn })} />
        </div>
        {draft.paymentOn ? (
          <FormField htmlFor="approval-payment-up-to" label={t('paymentUpTo')} error={shown(errors.payment)}>
            <MoneyInput id="approval-payment-up-to" value={draft.paymentUpTo} disabled={disabled} onValueChange={(paymentUpTo) => patch({ paymentUpTo })} />
          </FormField>
        ) : null}
      </FormGroup>

      {mayManage ? (
        <div className="flex gap-3">
          <Button type="submit" disabled={!dirty || save.isPending} loading={save.isPending} loadingText={t('saving')}>
            {t('save')}
          </Button>
          {dirty ? (
            <Button type="button" variant="ghost" onClick={() => setDraft(toDraft(saved))}>
              {t('discard')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
