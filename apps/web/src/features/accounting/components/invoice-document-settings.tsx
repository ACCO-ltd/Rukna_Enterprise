'use client';

/**
 * Accounting → Invoice settings.
 *
 * What the client invoice PDF prints beyond the invoice itself: the bank account clients are asked
 * to pay into (Payment Information, account number masked to its last four), the numbered notes,
 * and the authorised signatory. `view:accounting` reads; `manage:accounting` edits.
 *
 * An invoice freezes these when it is raised and again when it is issued, and a generated PDF never
 * changes — so an edit here reaches the next invoices, not documents already produced.
 */

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Combobox,
  type ComboboxOption,
  FormField,
  Input,
  Notice,
  Select,
  Textarea,
} from '@erp/ui';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useUsers } from '@/features/users/hooks/use-users';
import { ApiError } from '@/lib/api-client';

import {
  useBankAccounts,
  useInvoiceDocumentSettings,
  useUpdateInvoiceDocumentSettings,
} from '../hooks/use-accounting';
import type { BankAccount, InvoiceDocumentSettings } from '../types';

interface Draft {
  bankAccountId: string;
  notes: string;
  signatoryUserId: string;
  signatoryTitle: string;
}

function toDraft(settings: InvoiceDocumentSettings): Draft {
  return {
    bankAccountId: settings.bankAccountId ?? '',
    notes: settings.notes ?? '',
    signatoryUserId: settings.signatoryUserId ?? '',
    signatoryTitle: settings.signatoryTitle ?? '',
  };
}

/** "USD …4410" — the form shows the account the way the invoice will print it. */
export function maskedAccount(bank: Pick<BankAccount, 'accountNumber' | 'currencyCode'>): string {
  return `${bank.currencyCode} …${bank.accountNumber.replace(/\s+/g, '').slice(-4)}`;
}

/** Only an active account that accepts receipts can be printed for clients to pay into. */
export function invoiceBankCandidates(banks: BankAccount[]): BankAccount[] {
  return banks.filter((bank) => bank.status === 'ACTIVE' && bank.allowsReceipts);
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
  const ids = {
    bank: useId(),
    signatory: useId(),
    title: useId(),
    notes: useId(),
  };

  const banks = useBankAccounts();
  const users = useUsers();
  const save = useUpdateInvoiceDocumentSettings();

  const saved = toDraft(settings);
  const [draft, setDraft] = useState<Draft>(saved);

  const candidates = useMemo(() => invoiceBankCandidates(banks.data ?? []), [banks.data]);
  const selectedBank = candidates.find((bank) => bank.id === draft.bankAccountId) ?? null;

  const userOptions = useMemo<ComboboxOption[]>(
    () =>
      (users.data ?? [])
        .filter((user) => user.status === 'ACTIVE')
        .map((user) => ({
          value: user.id,
          label: `${user.firstName} ${user.lastName}`.trim() || user.email,
          hint: user.email,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [users.data],
  );

  const dirty = (Object.keys(draft) as Array<keyof Draft>).some((key) => draft[key] !== saved[key]);
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const disabled = !mayManage || save.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    save.mutate({
      bankAccountId: draft.bankAccountId || null,
      notes: draft.notes.trim() ? draft.notes : null,
      signatoryUserId: draft.signatoryUserId || null,
      signatoryTitle: draft.signatoryUserId && draft.signatoryTitle.trim() ? draft.signatoryTitle : null,
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
          <h3 className="text-sm font-semibold text-foreground">{t('paymentTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('paymentHint')}</p>
        </div>
        <FormField htmlFor={ids.bank} label={t('bankAccount')}>
          <Select
            id={ids.bank}
            value={draft.bankAccountId}
            onChange={(value) => patch({ bankAccountId: value })}
            disabled={disabled || banks.isPending}
          >
            <option value="">{t('noBankAccount')}</option>
            {candidates.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.bankName} · {bank.accountName} · {maskedAccount(bank)}
              </option>
            ))}
          </Select>
        </FormField>
        {banks.isError ? <Alert variant="error" messages={[t('banksLoadFailed')]} /> : null}
        {selectedBank ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('previewBank')}</dt>
            <dd className="text-foreground">{selectedBank.bankName}</dd>
            <dt className="text-muted-foreground">{t('previewAccountName')}</dt>
            <dd className="text-foreground">{selectedBank.accountName}</dd>
            <dt className="text-muted-foreground">{t('previewAccountNumber')}</dt>
            <dd className="tabular-nums text-foreground">{maskedAccount(selectedBank)}</dd>
            <dt className="text-muted-foreground">{t('previewSwift')}</dt>
            <dd className="text-foreground">{selectedBank.swiftCode ?? t('previewSwiftNone')}</dd>
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">{t('noBankHint')}</p>
        )}
      </section>

      <section className="space-y-3 rounded-panel border border-border bg-surface p-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('signatoryTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('signatoryHint')}</p>
        </div>
        {users.isError ? (
          <Alert variant="error" messages={[t('usersLoadFailed')]} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField htmlFor={ids.signatory} label={t('signatory')}>
              <Combobox
                id={ids.signatory}
                value={draft.signatoryUserId}
                onChange={(value) => patch({ signatoryUserId: value })}
                options={userOptions}
                placeholder={t('signatoryPlaceholder')}
                searchPlaceholder={t('signatorySearch')}
                emptyLabel={t('signatoryEmpty')}
                loading={users.isPending}
                disabled={disabled || users.isPending}
              />
            </FormField>
            <FormField htmlFor={ids.title} label={t('jobTitle')}>
              <Input
                id={ids.title}
                value={draft.signatoryTitle}
                onChange={(event) => patch({ signatoryTitle: event.target.value })}
                placeholder={t('jobTitlePlaceholder')}
                maxLength={120}
                disabled={disabled || !draft.signatoryUserId}
                autoComplete="off"
              />
            </FormField>
          </div>
        )}
        {draft.signatoryUserId && mayManage ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => patch({ signatoryUserId: '', signatoryTitle: '' })}
            disabled={disabled}
          >
            {t('clearSignatory')}
          </Button>
        ) : null}
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
          <Button type="button" variant="outline" disabled={!dirty || save.isPending} onClick={() => setDraft(saved)}>
            {t('discard')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
