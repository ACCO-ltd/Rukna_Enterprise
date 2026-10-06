'use client';

/**
 * Accounting → Invoice settings.
 *
 * What the client invoice PDF prints beyond the invoice itself: the tagline under the logo, the
 * footer contact strip (address, phones, email, website), the authorised signatory's name and
 * title, and two optional sections that are off unless switched on — the "Bank Account Details"
 * table (typed rows, not linked to the accounting bank accounts) and the numbered notes.
 * `view:accounting` reads; `manage:accounting` edits.
 *
 * An invoice freezes these when it is raised and again when it is issued, and a generated PDF never
 * changes — so an edit here reaches the next invoices, not documents already produced.
 */

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, CheckboxField, FormField, Input, Notice, Textarea } from '@erp/ui';

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
  tagline: string;
  footerAddress: string;
  phone1: string;
  phone2: string;
  footerEmail: string;
  footerWebsite: string;
  showBankDetails: boolean;
  showNotes: boolean;
}

function toDraft(settings: InvoiceDocumentSettings): Draft {
  return {
    paymentAccounts: settings.paymentAccounts.map((row) => ({ ...row })),
    notes: settings.notes ?? '',
    signatoryName: settings.signatoryName ?? '',
    signatoryTitle: settings.signatoryTitle ?? '',
    tagline: settings.tagline ?? '',
    footerAddress: settings.footerAddress ?? '',
    phone1: settings.footerPhones[0] ?? '',
    phone2: settings.footerPhones[1] ?? '',
    footerEmail: settings.footerEmail ?? '',
    footerWebsite: settings.footerWebsite ?? '',
    showBankDetails: settings.showBankDetails,
    showNotes: settings.showNotes,
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEBSITE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i;

/** The footer strip's limits — the same as the server's. */
export const FOOTER_LIMITS = { addressLines: 2, lineLength: 60, phone: 30, email: 80, website: 80 } as const;

type ContactProblem = 'address' | 'email' | 'website';

/** The contact fields that would be refused on save, for inline errors before the round trip. */
export function contactProblems(
  draft: Pick<Draft, 'footerEmail' | 'footerWebsite'> & { footerAddress?: string },
): ContactProblem[] {
  const problems: ContactProblem[] = [];
  const addressLines = (draft.footerAddress ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    addressLines.length > FOOTER_LIMITS.addressLines ||
    addressLines.some((line) => line.length > FOOTER_LIMITS.lineLength)
  ) {
    problems.push('address');
  }
  if (draft.footerEmail.trim() && !EMAIL.test(draft.footerEmail.trim())) problems.push('email');
  if (draft.footerWebsite.trim() && !WEBSITE.test(draft.footerWebsite.trim())) problems.push('website');
  return problems;
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
  const ids = {
    name: `${baseId}-name`,
    title: `${baseId}-title`,
    notes: `${baseId}-notes`,
    tagline: `${baseId}-tagline`,
    address: `${baseId}-address`,
    phone1: `${baseId}-phone1`,
    phone2: `${baseId}-phone2`,
    email: `${baseId}-email`,
    website: `${baseId}-website`,
    showBank: `${baseId}-show-bank`,
    showNotes: `${baseId}-show-notes`,
  };

  const save = useUpdateInvoiceDocumentSettings();
  const saved = toDraft(settings);
  const [draft, setDraft] = useState<Draft>(saved);
  const [showErrors, setShowErrors] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const disabled = !mayManage || save.isPending;
  const incomplete = incompleteRows(draft.paymentAccounts);
  const contacts = contactProblems(draft);

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
    if (incomplete.length > 0 || contacts.length > 0) {
      setShowErrors(true);
      return;
    }
    save.mutate({
      paymentAccounts: rowsToSave(draft.paymentAccounts),
      notes: draft.notes.trim() ? draft.notes : null,
      signatoryName: draft.signatoryName.trim() || null,
      signatoryTitle: draft.signatoryTitle.trim() || null,
      tagline: draft.tagline.trim() || null,
      footerAddress: draft.footerAddress.trim() ? draft.footerAddress : null,
      footerPhones: [draft.phone1, draft.phone2].map((p) => p.trim()).filter(Boolean),
      footerEmail: draft.footerEmail.trim() || null,
      footerWebsite: draft.footerWebsite.trim() || null,
      showBankDetails: draft.showBankDetails,
      showNotes: draft.showNotes,
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
          <h3 className="text-sm font-semibold text-foreground">{t('headerTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('headerHint')}</p>
        </div>
        <FormField htmlFor={ids.tagline} label={t('tagline')}>
          <Input
            id={ids.tagline}
            value={draft.tagline}
            onChange={(event) => patch({ tagline: event.target.value })}
            placeholder={t('taglinePlaceholder')}
            maxLength={80}
            disabled={disabled}
            autoComplete="off"
          />
        </FormField>
      </section>

      <section className="space-y-3 rounded-panel border border-border bg-surface p-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('footerTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('footerHint')}</p>
        </div>
        <FormField
          htmlFor={ids.address}
          label={t('footerAddress')}
          hint={t('footerAddressHint', { lines: FOOTER_LIMITS.addressLines, chars: FOOTER_LIMITS.lineLength })}
          error={showErrors && contacts.includes('address') ? t('footerAddressInvalid') : undefined}
        >
          <Textarea
            id={ids.address}
            value={draft.footerAddress}
            onChange={(event) => patch({ footerAddress: event.target.value })}
            rows={2}
            maxLength={FOOTER_LIMITS.addressLines * (FOOTER_LIMITS.lineLength + 1)}
            disabled={disabled}
            placeholder={settings.defaultFooterAddress ?? t('footerAddressPlaceholder')}
          />
        </FormField>
        {!draft.footerAddress.trim() && settings.defaultFooterAddress ? (
          <p className="text-xs text-muted-foreground">{t('footerAddressDefault')}</p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor={ids.phone1} label={t('phone', { n: 1 })} hint={t('limitHint', { chars: FOOTER_LIMITS.phone })}>
            <Input
              id={ids.phone1}
              type="tel"
              value={draft.phone1}
              onChange={(event) => patch({ phone1: event.target.value })}
              placeholder="+252 61 234 5678"
              maxLength={FOOTER_LIMITS.phone}
              disabled={disabled}
              autoComplete="off"
            />
          </FormField>
          <FormField htmlFor={ids.phone2} label={t('phone', { n: 2 })} hint={t('limitHint', { chars: FOOTER_LIMITS.phone })}>
            <Input
              id={ids.phone2}
              type="tel"
              value={draft.phone2}
              onChange={(event) => patch({ phone2: event.target.value })}
              placeholder="+252 90 123 4567"
              maxLength={FOOTER_LIMITS.phone}
              disabled={disabled}
              autoComplete="off"
            />
          </FormField>
          <FormField
            htmlFor={ids.email}
            label={t('email')}
            hint={t('limitHint', { chars: FOOTER_LIMITS.email })}
            error={showErrors && contacts.includes('email') ? t('emailInvalid') : undefined}
          >
            <Input
              id={ids.email}
              type="email"
              value={draft.footerEmail}
              onChange={(event) => patch({ footerEmail: event.target.value })}
              placeholder="info@acco.com"
              maxLength={FOOTER_LIMITS.email}
              disabled={disabled}
              autoComplete="off"
            />
          </FormField>
          <FormField
            htmlFor={ids.website}
            label={t('website')}
            hint={t('limitHint', { chars: FOOTER_LIMITS.website })}
            error={showErrors && contacts.includes('website') ? t('websiteInvalid') : undefined}
          >
            <Input
              id={ids.website}
              value={draft.footerWebsite}
              onChange={(event) => patch({ footerWebsite: event.target.value })}
              placeholder="www.acco.com"
              maxLength={FOOTER_LIMITS.website}
              disabled={disabled}
              autoComplete="off"
            />
          </FormField>
        </div>
      </section>

      <section className="space-y-3 rounded-panel border border-border bg-surface p-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('banksTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('banksHint')}</p>
        </div>
        <CheckboxField
          id={ids.showBank}
          label={t('showBankDetails')}
          description={t('showBankDetailsHint')}
          checked={draft.showBankDetails}
          onChange={(event) => patch({ showBankDetails: event.target.checked })}
          disabled={disabled}
        />

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
        <CheckboxField
          id={ids.showNotes}
          label={t('showNotes')}
          description={t('showNotesHint')}
          checked={draft.showNotes}
          onChange={(event) => patch({ showNotes: event.target.checked })}
          disabled={disabled}
        />
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
