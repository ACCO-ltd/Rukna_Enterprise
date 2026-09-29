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
  Combobox,
  type ComboboxOption,
  FormField,
  Input,
  Select,
  Dialog,
  DialogContent,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useUsers } from '@/features/users/hooks/use-users';
import { ApiError } from '@/lib/api-client';
import { statusTone } from '@/lib/status-registry';
import { formatDate } from '@/lib/format';

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
  useAddSignatory,
  useBankAccounts,
  useConfigureBankAccount,
  useRemoveSignatory,
  useSignatories,
} from '../hooks/use-accounting';
import type { BankAccount } from '../types';

export function BankAccounts() {
  const t = useTranslations('accounting.bankAccounts');
  const { can } = usePermissions();

  const banks = useBankAccounts();
  const [creating, setCreating] = useState(false);
  const [signatoryBank, setSignatoryBank] = useState<BankAccount | null>(null);

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
          {bank.allowsReceipts ? <Badge tone="neutral">{t('receipts')}</Badge> : null}
          {bank.allowsPayments ? <Badge tone="neutral">{t('payments')}</Badge> : null}
          {!bank.allowsReceipts && !bank.allowsPayments ? (
            <Badge tone="attention">{t('neither')}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('colStatus'),
      render: (bank) => (
        <StatusPill tone={statusTone(bank.status, 'masterData')}>
          {t(`status.${bank.status}`)}
        </StatusPill>
      ),
    },
    {
      key: 'signatories',
      header: '',
      render: (bank) =>
        bank.allowsPayments ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setSignatoryBank(bank);
            }}
          >
            {t('signatories.button')}
          </Button>
        ) : null,
    },
  ];

  const createAction = can(ACCOUNTING_PERMISSIONS.manageChart) ? (
    <Button type="button" onClick={() => setCreating(true)}>
      {t('create.new')}
    </Button>
  ) : null;

  return (
    <div className="space-y-6">

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
              {createAction ? <div className="mt-4 flex justify-center">{createAction}</div> : null}
            </div>
          ) : undefined
        }
        pagination={{ defaultPageSize: 25 }}
        toolbarActions={createAction}
      />

      <p className="max-w-prose text-xs text-muted-foreground">{t('readOnlyNote')}</p>

      <Sheet
        open={signatoryBank !== null}
        onOpenChange={(open) => { if (!open) setSignatoryBank(null); }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t('signatories.sheetTitle')}</SheetTitle>
            <SheetDescription>{signatoryBank?.accountName ?? ''}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            {signatoryBank && <SignatoriesPanel bank={signatoryBank} />}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Signatories ─────────────────────────────────────────────────────────────────

/** `firstName lastName`, falling back to the email when the name is blank. */
function signatoryUserLabel(user: { firstName: string; lastName: string; email: string }): string {
  const full = `${user.firstName} ${user.lastName}`.trim();
  return full || user.email;
}

function SignatoriesPanel({ bank }: { bank: BankAccount }) {
  const t = useTranslations('accounting.bankAccounts.signatories');
  const locale = useLocale() as 'en';

  const query = useSignatories(bank.id);
  const add = useAddSignatory(bank.id);
  const remove = useRemoveSignatory(bank.id);
  // Reuses the admin Users hook (`GET /users`) rather than a second users source — the same one
  // the project-member picker consumes.
  const users = useUsers();

  const [userId, setUserId] = useState('');

  const signatories = (query.data ?? []).filter((s) => s.isActive);

  // Resolve a signatory's id to a readable name for the table. A user missing from the list (a
  // deactivated account, say) falls back to the id so the row is never blank.
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of users.data ?? []) map.set(user.id, signatoryUserLabel(user));
    return map;
  }, [users.data]);

  // The picker offers every org user who is not already an active signatory of this account —
  // adding one who is answers an error, so they are filtered out rather than offered and refused.
  const options = useMemo<ComboboxOption[]>(() => {
    const taken = new Set(signatories.map((s) => s.userId));
    return (users.data ?? [])
      .filter((user) => !taken.has(user.id))
      .map((user) => ({ value: user.id, label: signatoryUserLabel(user), hint: user.email }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [users.data, signatories]);

  function handleAdd() {
    const trimmed = userId.trim();
    if (!trimmed) return;
    add.mutate(trimmed, { onSuccess: () => setUserId('') });
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">{t('dualControlNote')}</p>

      {query.isError && <Alert variant="error" messages={[t('loadFailed')]} />}

      {!query.isError && signatories.length === 0 && !query.isPending && (
        <div className="rounded-panel border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
        </div>
      )}

      {signatories.length > 0 && (
        <TableScroll aria-label={t('sheetTitle')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colUser')}</TableHead>
                <TableHead>{t('colAddedAt')}</TableHead>
                <TableHead>{t('colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {signatories.map((s) => {
                const name = nameById.get(s.userId);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm text-foreground">
                      {name ?? <span className="font-mono text-xs text-muted-foreground">{s.userId}</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(s.addedAt, locale)}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(s.userId)}
                      >
                        {t('remove')}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
      )}

      {remove.isError && (
        <Alert variant="error" messages={[remove.error instanceof ApiError ? remove.error.message : t('removeFailed')]} />
      )}

      <div className="space-y-3 rounded-panel border border-border p-4">
        <p className="text-sm font-medium text-foreground">{t('addTitle')}</p>
        {users.isError ? (
          <Alert variant="error" messages={[t('usersLoadFailed')]} />
        ) : !users.isPending && options.length === 0 ? (
          <Alert variant="info" messages={[t('everyoneAdded')]} />
        ) : (
          <FormField htmlFor="sig-user" label={t('user')}>
            <Combobox
              id="sig-user"
              value={userId}
              onChange={setUserId}
              options={options}
              placeholder={t('userPlaceholder')}
              searchPlaceholder={t('userSearch')}
              emptyLabel={t('userEmpty')}
              loading={users.isPending}
              disabled={users.isPending || add.isPending}
            />
            <p className="text-xs text-muted-foreground">{t('userHint')}</p>
          </FormField>
        )}
        {add.isError && (
          <Alert variant="error" messages={[add.error instanceof ApiError ? add.error.message : t('addFailed')]} />
        )}
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={handleAdd}
            disabled={!userId.trim() || add.isPending || users.isPending || users.isError}
          >
            {t('add')}
          </Button>
        </div>
      </div>
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
