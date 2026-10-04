'use client';

/**
 * Accounting → Invoice settings.
 *
 * What the client invoice PDF prints beyond the invoice itself: the "Bank Account Details" table
 * (typed rows of bank name + account number, like ACCO's own invoices — not linked to the
 * accounting bank accounts), the numbered notes, and the authorised signatory's name and title.
 * `view:accounting` reads; `manage:accounting` edits.
 *
 * An invoice freezes these when it is raised and again when it is issued, and a generated PDF never
 * changes — so an edit here reaches the next invoices, not documents already produced.
 */

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input, Notice, Textarea } from '@erp/ui';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';

import { useInvoiceDocumentSettings, useUpdateInvoiceDocumentSettings } from '../hooks/use-accounting';
import type { InvoiceDocumentSettings, InvoicePaymentAccount } from '../types';

export const MAX_PAYMENT_ACCOUNTS = 8;

interface Draft {
  paymentAccounts: InvoicePaymentAccount[];
  notes: string;
  signatoryName: string;
  signatoryTitle: string;
}

function toDraft(settings: InvoiceDocumentSettings): Draft {
  return {
    paymentAccounts: settings.paymentAccounts.map((row) => ({ ...row })),
    notes: settings.notes ?? '',
    signatoryName: settings.signatoryName ?? '',
    signatoryTitle: settings.signatoryTitle ?? '',
  };
}

/** Indexes of rows with one field filled and the other blank (a fully blank row is just dropped). */
export function incompleteRows(rows: InvoicePaymentAccount[]): number[] {
  return rows.flatMap((row, i) => {
    const bank = row.bankName.trim();
    const number = row.accountNumber.trim();
    return (bank && !number) || (!bank && number) ? [i] : [];
  });
}

/** The rows to save: trimmed, fully blank rows removed. */
export function rowsToSave(rows: InvoicePaymentAccount[]): InvoicePaymentAccount[] {
  return rows
    .map((row) => ({ bankName: row.bankName.trim(), accountNumber: row.accountNumber.trim() }))
    .filter((row) => row.bankName || row.accountNumber);
}

export function InvoiceDocumentSettingsPanel() {
  const t = useTranslations('accounting.invoiceSettings');
  const settings = useInvoiceDocumentSettings();

  if (settings.isError) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }
  if (!settings.data) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }
  // Keyed by the saved version: a save (or another person's) starts the form from what is stored.
  return <SettingsForm key={settings.data.updatedAt ?? 'unsaved'} settings={settings.data} />;
}

function SettingsForm({ settings }: { settings: InvoiceDocumentSettings }) {
  const t = useTranslations('accounting.invoiceSettings');
  const { can } = usePermissions();
  const mayManage = can(ACCOUNTING_PERMISSIONS.manageChart);
  const baseId = useId();
  const ids = { name: `${baseId}-name`, title: `${baseId}-title`, notes: `${baseId}-notes` };

  const save = useUpdateInvoiceDocumentSettings();
  const saved = toDraft(settings);
  const [draft, setDraft] = useState<Draft>(saved);
  const [showErrors, setShowErrors] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const disabled = !mayManage || save.isPending;
  const incomplete = incompleteRows(draft.paymentAccounts);

  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const patchRow = (index: number, next: Partial<InvoicePaymentAccount>) =>
    patch({
      paymentAccounts: draft.paymentAccounts.map((row, i) => (i === index ? { ...row, ...next } : row)),
    });
  const removeRow = (index: number) =>
    patch({ paymentAccounts: draft.paymentAccounts.filter((_, i) => i !== index) });
  const addRow = () => patch({ paymentAccounts: [...draft.paymentAccounts, { bankName: '', accountNumber: '' }] });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (incomplete.length > 0) {
      setShowErrors(true);
      return;
    }
    save.mutate({
      paymentAccounts: rowsToSave(draft.paymentAccounts),
      notes: draft.notes.trim() ? draft.notes : null,
      signatoryName: draft.signatoryName.trim() || null,
      signatoryTitle: draft.signatoryTitle.trim() || null,
    });
  }

  const saveError = save.isError
    ? save.error instanceof ApiError
      ? save.error.message
      : t('saveFailed')
    : null;

  return (
    <form className="space-y-6" onSubmit={handleSubmit} aria-label={t('title')}>
      <div>
        <h2 className="text-h2 font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{t('description')}</p>
      </div>

      <Notice tone="info">{t('frozenNotice')}</Notice>
      {!mayManage ? <Notice tone="attention">{t('readOnly')}</Notice> : null}

      <section className="space-y-3 rounded-panel border border-border bg-surface p-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('banksTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('banksHint')}</p>
        </div>

        {draft.paymentAccounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('noBanks')}</p>
        ) : (
          <ul className="space-y-2" aria-label={t('banksTitle')}>
            {draft.paymentAccounts.map((row, index) => {
              const rowInvalid = showErrors && incomplete.includes(index);
              return (
                <li key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <FormField htmlFor={`${baseId}-bank-${index}`} label={t('bankName', { n: index + 1 })}>
                    <Input
                      id={`${baseId}-bank-${index}`}
                      value={row.bankName}
                      onChange={(event) => patchRow(index, { bankName: event.target.value })}
                      placeholder={t('bankNamePlaceholder')}
                      maxLength={100}
                      disabled={disabled}
                      aria-invalid={rowInvalid && !row.bankName.trim() ? true : undefined}
                      autoComplete="off"
                    />
                  </FormField>
                  <FormField htmlFor={`${baseId}-number-${index}`} label={t('accountNumber', { n: index + 1 })}>
                    <Input
                      id={`${baseId}-number-${index}`}
                      value={row.accountNumber}
                      onChange={(event) => patchRow(index, { accountNumber: event.target.value })}
                      placeholder={t('accountNumberPlaceholder')}
                      maxLength={50}
                      disabled={disabled}
                      className="tabular-nums"
                      aria-invalid={rowInvalid && !row.accountNumber.trim() ? true : undefined}
                      autoComplete="off"
                    />
                  </FormField>
                  {mayManage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRow(index)}
                      disabled={disabled}
                      aria-label={t('removeBankLabel', { n: index + 1 })}
                    >
                      {t('removeBank')}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {showErrors && incomplete.length > 0 ? (
          <Alert variant="error" messages={[t('rowIncomplete')]} />
        ) : null}

        {mayManage ? (
          draft.paymentAccounts.length < MAX_PAYMENT_ACCOUNTS ? (
            <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={disabled}>
              {t('addBank')}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">{t('maxBanks', { max: MAX_PAYMENT_ACCOUNTS })}</p>
          )
        ) : null}
      </section>

      <section className="space-y-3 rounded-panel border border-border bg-surface p-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('signatoryTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('signatoryHint')}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor={ids.name} label={t('signatoryName')}>
            <Input
              id={ids.name}
              value={draft.signatoryName}
              onChange={(event) => patch({ signatoryName: event.target.value })}
              placeholder={t('signatoryNamePlaceholder')}
              maxLength={120}
              disabled={disabled}
              autoComplete="off"
            />
          </FormField>
          <FormField htmlFor={ids.title} label={t('jobTitle')}>
            <Input
              id={ids.title}
              value={draft.signatoryTitle}
              onChange={(event) => patch({ signatoryTitle: event.target.value })}
              placeholder={t('jobTitlePlaceholder')}
              maxLength={120}
              disabled={disabled}
              autoComplete="off"
            />
          </FormField>
        </div>
      </section>

      <section className="space-y-3 rounded-panel border border-border bg-surface p-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('notesTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('notesHint')}</p>
        </div>
        <FormField htmlFor={ids.notes} label={t('notes')}>
          <Textarea
            id={ids.notes}
            value={draft.notes}
            onChange={(event) => patch({ notes: event.target.value })}
            rows={5}
            maxLength={2000}
            disabled={disabled}
            placeholder={settings.defaultNotes.join('\n')}
          />
        </FormField>
        {!draft.notes.trim() ? (
          <div className="text-xs text-muted-foreground">
            <p>{t('defaultsApply')}</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              {settings.defaultNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>

      {saveError ? <Alert variant="error" messages={[saveError]} /> : null}

      {mayManage ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending} disabled={!dirty || save.isPending}>
            {t('save')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDraft(saved);
              setShowErrors(false);
            }}
          >
            {t('discard')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
