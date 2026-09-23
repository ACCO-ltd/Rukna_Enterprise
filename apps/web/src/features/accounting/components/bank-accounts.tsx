'use client';

/**
 * Bank accounts (tenant bootstrap, tier 3).
 *
 * `GET /bank-accounts` has been consumed since AP Tier C — the payment form picks from it —
 * but nothing listed or created one, so the only bank accounts that ever existed were the two
 * the seed makes. An organisation banking anywhere else could not record a payment.
 *
 * A bank account is a thin record over a GL account: `glAccountId` is `@unique`, so each cash
 * account in the chart maps to exactly one, and the mapping is what lets a payment name both a
 * bank to draw on and a GL line to credit.
 */

import { useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  CheckboxField,
  FormField,
  Input,
  Select,
  Dialog,
  DialogContent,
  DialogTitle,
} from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';

import { accountName } from '../account-display';
import {
  bankAccountProblems,
  emptyBankAccountDraft,
  glAvailability,
  mappableGlAccounts,
  toConfigureBankAccountBody,
  type BankAccountDraft,
} from '../bank-account-setup';
import {
  useAccounts,
  useBankAccounts,
  useConfigureBankAccount,
} from '../hooks/use-accounting';
import type { BankAccount } from '../types';

export function BankAccounts() {
  const t = useTranslations('accounting.bankAccounts');
  const { can } = usePermissions();

  const banks = useBankAccounts();
  const [creating, setCreating] = useState(false);

  const columns: GridColumn<BankAccount>[] = [
    {
      key: 'bank',
      header: t('colBank'),
      sticky: true,
      sortable: true,
      plainValue: (bank) => bank.bankName,
      render: (bank) => <span className="text-sm text-foreground">{bank.bankName}</span>,
    },
    {
      key: 'account',
      header: t('colAccount'),
      sortable: true,
      plainValue: (bank) => bank.accountName,
      render: (bank) => <span className="text-sm text-foreground">{bank.accountName}</span>,
    },
    {
      key: 'number',
      header: t('colNumber'),
      render: (bank) => (
        // Masked to the last four. A full account number on a list screen is a detail
        // nobody needs at a glance and everybody can screenshot.
        <span className="font-mono text-xs text-muted-foreground">
          ****{bank.accountNumber.slice(-4)}
        </span>
      ),
    },
    {
      key: 'use',
      header: t('colUse'),
      render: (bank) => (
        <span className="flex flex-wrap gap-1">
          {bank.allowsReceipts ? <Badge tone="info">{t('receipts')}</Badge> : null}
          {bank.allowsPayments ? <Badge tone="accent">{t('payments')}</Badge> : null}
          {!bank.allowsReceipts && !bank.allowsPayments ? (
            <Badge tone="warning">{t('neither')}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('colStatus'),
      render: (bank) => (
        <Badge tone={bank.status === 'ACTIVE' ? 'live' : 'neutral'}>
          {t(`status.${bank.status}`)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {can(ACCOUNTING_PERMISSIONS.manageChart) ? (
          <Button type="button" onClick={() => setCreating(true)}>
            {t('create.new')}
          </Button>
        ) : null}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="p-6 sm:max-w-lg">
          <DialogTitle className="text-lg font-semibold text-foreground">
            {t('create.title')}
          </DialogTitle>
          <div className="mt-5">
            <ConfigureBankAccountForm onDone={() => setCreating(false)} />
          </div>
        </DialogContent>
      </Dialog>

      <PlatformDataGrid
        columns={columns}
        data={banks.data ?? []}
        rowKey={(bank) => bank.id}
        label={t('title')}
        isLoading={banks.isPending}
        isError={banks.isError}
        errorMessage={t('loadFailed')}
        emptyState={
          (banks.data?.length ?? 0) === 0 ? (
            <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
                {t('emptyHint')}
              </p>
            </div>
          ) : undefined
        }
        pagination={{ defaultPageSize: 25 }}
      />

      <p className="max-w-prose text-xs text-muted-foreground">{t('readOnlyNote')}</p>
    </div>
  );
}

// ─── Create ──────────────────────────────────────────────────────────────────────

function ConfigureBankAccountForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('accounting.bankAccounts.create');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const [draft, setDraft] = useState<BankAccountDraft>(emptyBankAccountDraft());
  const [showErrors, setShowErrors] = useState(false);

  const accounts = useAccounts();
  const banks = useBankAccounts();
  const configure = useConfigureBankAccount();

  const ids = {
    bankName: useId(),
    accountName: useId(),
    accountNumber: useId(),
    currency: useId(),
    gl: useId(),
    allowsReceipts: useId(),
    allowsPayments: useId(),
  };

  const candidates = useMemo(
    () => mappableGlAccounts(accounts.data ?? [], banks.data ?? []),
    [accounts.data, banks.data],
  );
  const availability = glAvailability(accounts.data ?? [], banks.data ?? []);

  const problems = bankAccountProblems(draft);
  const serverError = configure.error instanceof ApiError ? configure.error.message : null;

  function patch(next: Partial<BankAccountDraft>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  function handleSubmit() {
    setShowErrors(true);
    const body = toConfigureBankAccountBody(draft);
    if (!body) return;

    configure.mutate(body, { onSuccess: onDone });
  }

  if (availability !== null) {
    return (
      <Alert
        variant={availability === 'all-mapped' ? 'info' : 'error'}
        title={t(`unavailable.${availability}.title`)}
        messages={[t(`unavailable.${availability}.body`)]}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* A19 — the DTO offers an Arabic name, the column does not exist, and sending it fails
          the request. Said here so the omission does not read as an oversight. */}
      <Alert variant="info" messages={[t('noArabicName')]} />

      <FormField htmlFor={ids.bankName} label={t('bankName')}>
        <Input
          id={ids.bankName}
          value={draft.bankName}
          onChange={(e) => patch({ bankName: e.target.value })}
          maxLength={255}
          autoComplete="off"
        />
      </FormField>

      <FormField htmlFor={ids.accountName} label={t('accountName')}>
        <Input
          id={ids.accountName}
          value={draft.accountName}
          onChange={(e) => patch({ accountName: e.target.value })}
          maxLength={255}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{t('accountNameHint')}</p>
      </FormField>

      <FormField htmlFor={ids.accountNumber} label={t('accountNumber')}>
        <Input
          id={ids.accountNumber}
          value={draft.accountNumber}
          onChange={(e) => patch({ accountNumber: e.target.value })}
          maxLength={50}
          autoComplete="off"
        />
      </FormField>

      <FormField htmlFor={ids.gl} label={t('glAccount')}>
        <Select
          id={ids.gl}
          value={draft.glAccountCode}
          onChange={(value) => patch({ glAccountCode: value })}
        >
          <option value="" disabled>
            —
          </option>
          {candidates.map((account) => (
            <option key={account.id} value={account.code}>
              {account.code} · {accountName(account, locale)}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">{t('glAccountHint')}</p>
      </FormField>

      <fieldset className="space-y-1 rounded-control border border-border p-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">{t('useLegend')}</legend>

        <CheckboxField
          id={ids.allowsReceipts}
          label={t('allowsReceipts')}
          checked={draft.allowsReceipts}
          onChange={(e) => patch({ allowsReceipts: e.target.checked })}
        />

        <CheckboxField
          id={ids.allowsPayments}
          label={t('allowsPayments')}
          checked={draft.allowsPayments}
          onChange={(e) => patch({ allowsPayments: e.target.checked })}
        />

        <p className="text-xs text-muted-foreground">{t('useHint')}</p>
      </fieldset>

      {showErrors && problems.length > 0 ? (
        <Alert
          variant="error"
          title={t('missingTitle')}
          messages={problems.map((problem) => t(`missing.${problem}`))}
        />
      ) : null}

      {serverError ? <Alert variant="error" messages={[serverError]} /> : null}

      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={configure.isPending}>
          {tCommon('cancel')}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={configure.isPending}>
          {configure.isPending ? tCommon('saving') : t('submit')}
        </Button>
      </div>
    </div>
  );
}
