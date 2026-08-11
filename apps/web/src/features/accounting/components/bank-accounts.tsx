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
  FormField,
  Input,
  Sheet,
  SheetContent,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

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

export function BankAccounts() {
  const t = useTranslations('accounting.bankAccounts');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();

  const banks = useBankAccounts();
  const [creating, setCreating] = useState(false);

  if (banks.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-lg border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (banks.isError) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }

  const rows = banks.data ?? [];

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

      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent className="p-6">
          <SheetTitle className="text-lg font-semibold text-foreground">
            {t('create.title')}
          </SheetTitle>
          <div className="mt-5">
            <ConfigureBankAccountForm onDone={() => setCreating(false)} />
          </div>
        </SheetContent>
      </Sheet>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
            {t('emptyHint')}
          </p>
        </div>
      ) : (
        <TableScroll aria-label={t('title')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colBank')}</TableHead>
                <TableHead>{t('colAccount')}</TableHead>
                <TableHead>{t('colNumber')}</TableHead>
                <TableHead>{t('colCurrency')}</TableHead>
                <TableHead>{t('colUse')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((bank) => (
                <TableRow key={bank.id}>
                  <TableCell className="text-sm text-foreground">{bank.bankName}</TableCell>
                  <TableCell className="text-sm text-foreground">{bank.accountName}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {/* Masked to the last four. A full account number on a list screen is a
                        detail nobody needs at a glance and everybody can screenshot. */}
                    ****{bank.accountNumber.slice(-4)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {bank.currencyCode}
                  </TableCell>
                  <TableCell className="space-x-1">
                    {bank.allowsReceipts ? (
                      <Badge tone="info">{t('receipts')}</Badge>
                    ) : null}
                    {bank.allowsPayments ? (
                      <Badge tone="accent">{t('payments')}</Badge>
                    ) : null}
                    {!bank.allowsReceipts && !bank.allowsPayments ? (
                      <Badge tone="warning">{t('neither')}</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge tone={bank.status === 'ACTIVE' ? 'live' : 'neutral'}>
                      {t(`status.${bank.status}`)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}

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

      <FormField htmlFor={ids.currency} label={t('currency')}>
        <Input
          id={ids.currency}
          value={draft.currencyCode}
          onChange={(e) => patch({ currencyCode: e.target.value.toUpperCase() })}
          maxLength={3}
          className="uppercase"
          autoComplete="off"
        />
      </FormField>

      <FormField htmlFor={ids.gl} label={t('glAccount')}>
        <select
          id={ids.gl}
          value={draft.glAccountCode}
          onChange={(e) => patch({ glAccountCode: e.target.value })}
          className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
        >
          <option value="" disabled>
            —
          </option>
          {candidates.map((account) => (
            <option key={account.id} value={account.code}>
              {account.code} · {accountName(account, locale)}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{t('glAccountHint')}</p>
      </FormField>

      <fieldset className="space-y-2 rounded-md border border-border p-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">{t('useLegend')}</legend>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.allowsReceipts}
            onChange={(e) => patch({ allowsReceipts: e.target.checked })}
            className="size-4"
          />
          {t('allowsReceipts')}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.allowsPayments}
            onChange={(e) => patch({ allowsPayments: e.target.checked })}
            className="size-4"
          />
          {t('allowsPayments')}
        </label>

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
