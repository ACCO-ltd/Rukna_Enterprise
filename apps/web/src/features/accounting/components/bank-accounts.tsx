'use client';

/**
 * Bank and cash accounts (BK). Every bank account, cash box and mobile-money wallet with what the
 * books say it holds and what the bank said when it was last reconciled; each opens to its own
 * page. A bank account is a thin record over a GL account: `glAccountId` is `@unique`, so each
 * cash account in the chart maps to exactly one.
 */

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  StatTile,
  Alert,
  Button,
  CheckboxField,
  Combobox,
  type ComboboxOption,
  FormField,
  Input,
  Select,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
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
import { formatDate, formatMoney } from '@/lib/format';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ListRowMenu } from '@/features/procurement/components/list-row-menu';
import { useRouter } from 'next/navigation';
import { MoneyDisplay } from '@erp/ui';
import { EditBankAccountDialog, accountNumberRecorded } from './bank-account-edit';

import { accountName } from '../account-display';
import { BANK_ACCOUNT_HREF, heldByKind, maskedAccountNumber } from '../bank-account-figures';
import {
  bankAccountProblems,
  cashAccountPreset,
  emptyBankAccountDraft,
  type CashAccountPreset,
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
  useSetBankAccountStatus,
  useSignatories,
} from '../hooks/use-accounting';
import type { BankAccount, BankAccountKind } from '../types';

const BANK_ACCOUNT_KINDS: readonly BankAccountKind[] = ['BANK', 'CASH', 'MOBILE_WALLET'];
import { LoadError } from '@/components/load-error';

export function BankAccounts({ preset = null }: { preset?: CashAccountPreset | null } = {}) {
  const t = useTranslations('accounting.bankAccounts');
  const tKind = useTranslations('accounting.bankAccounts.kind');
  const { can } = usePermissions();

  const banks = useBankAccounts();
  // ADR-045 P14: `?preset=cash-box` (from "Add a cash box or EVC float" on a payment) opens the
  // create form already filled.
  const mayCreate = can(ACCOUNTING_PERMISSIONS.manageChart);
  const [creating, setCreating] = useState<CashAccountPreset | 'blank' | null>(
    mayCreate && preset ? preset : null,
  );
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [statusChange, setStatusChange] = useState<{ bank: BankAccount; to: BankAccount['status'] } | null>(null);
  const router = useRouter();

  const rows = banks.data ?? [];
  const held = heldByKind(rows);
  const usd = (value: string) => formatMoney(value, 'USD') ?? value;

  const columns: GridColumn<BankAccount>[] = [
    {
      key: 'account',
      header: t('colAccount'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (bank) => bank.accountName,
      render: (bank) => {
        const masked = maskedAccountNumber(bank.accountNumber, accountNumberRecorded);
        return (
          <span className="block min-w-0">
            <Link href={BANK_ACCOUNT_HREF(bank.id)} className="font-medium text-foreground hover:text-brand-primary hover:underline">
              {bank.accountName}
            </Link>
            <span className="block text-caption text-muted-foreground">
              {[bank.bankName, masked].filter(Boolean).join(' · ')}
            </span>
          </span>
        );
      },
    },
    {
      key: 'kind',
      header: t('colKind'),
      sortable: true,
      card: 'meta',
      plainValue: (bank) => tKind(bank.kind ?? 'BANK'),
      render: (bank) => <span className="text-body-sm text-muted-foreground">{tKind(bank.kind ?? 'BANK')}</span>,
    },
    // B-1 — what the ledger says is in it, and what the bank said when it was last reconciled.
    {
      key: 'balance',
      header: t('colBalance'),
      numeric: true,
      sortable: true,
      card: 'amount',
      plainValue: (bank) => Number(bank.bookBalance ?? 0),
      render: (bank) => <MoneyDisplay value={bank.bookBalance ?? null} />,
    },
    {
      key: 'reconciled',
      header: t('colReconciled'),
      render: (bank) =>
        bank.lastReconciledTo ? (
          <span className="block text-body-sm">
            <span className="tabular-nums">{usd(bank.lastStatementBalance ?? '0')}</span>
            <span className="block text-caption text-muted-foreground">{t('onDate', { date: formatDate(bank.lastReconciledTo) ?? '' })}</span>
          </span>
        ) : (
          <span className="text-caption text-muted-foreground">{t('neverReconciled')}</span>
        ),
    },
    {
      key: 'status',
      header: t('colStatus'),
      card: 'status',
      render: (bank) => (
        <StatusPill tone={statusTone(bank.status, 'masterData')}>
          {t(`status.${bank.status}`)}
        </StatusPill>
      ),
    },
    {
      key: 'menu',
      header: '',
      render: (bank) => (
        <ListRowMenu
          label={t('rowMenu', { name: bank.accountName })}
          commands={[
            { key: 'open', label: t('open'), onSelect: () => router.push(BANK_ACCOUNT_HREF(bank.id)) },
            ...(bank.status === 'ACTIVE' && bank.allowsPayments
              ? [{ key: 'transfer', label: t('transferMoney'), onSelect: () => router.push(`/finance/accounting/transfers?new=1&from=${bank.id}`) }]
              : []),
            { key: 'reconcile', label: t('reconcile'), onSelect: () => router.push(`/finance/accounting/bank-reconciliation?account=${bank.id}`) },
            ...(mayCreate && bank.status !== 'CLOSED'
              ? [
                  { key: 'edit', label: t('editAction'), onSelect: () => setEditing(bank) },
                  bank.status === 'ACTIVE'
                    ? { key: 'suspend', label: t('suspend'), onSelect: () => setStatusChange({ bank, to: 'SUSPENDED' }) }
                    : { key: 'reactivate', label: t('reactivate'), onSelect: () => setStatusChange({ bank, to: 'ACTIVE' }) },
                  { key: 'close', label: t('close'), onSelect: () => setStatusChange({ bank, to: 'CLOSED' }) },
                ]
              : []),
          ]}
        />
      ),
    },
  ];

  const createAction = mayCreate ? <NewAccountMenu onPick={setCreating} /> : null;

  return (
    <div className="space-y-5">
      <ListPageHeader
        title={t('pageTitle')}
        summary={rows.length > 0 ? t('summary', { total: usd(held.total), count: held.count }) : undefined}
        actions={createAction}
      />

      {rows.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={t('tiles.total')} value={usd(held.total)} note={t('tiles.accounts', { count: held.count })} />
          <StatTile label={t('tiles.BANK')} value={usd(held.BANK)} />
          <StatTile label={t('tiles.CASH')} value={usd(held.CASH)} />
          <StatTile label={t('tiles.MOBILE_WALLET')} value={usd(held.MOBILE_WALLET)} />
        </div>
      ) : null}

      {creating ? (
        <ConfigureBankAccountForm
          title={creating === 'blank' ? t('create.title') : t(`cashPreset.title.${creating}`)}
          preset={creating === 'blank' ? null : creating}
          onDone={() => setCreating(null)}
        />
      ) : null}

      <PlatformDataGrid
        columns={columns}
        data={rows}
        rowKey={(bank) => bank.id}
        label={t('pageTitle')}
        isLoading={banks.isPending}
        isError={banks.isError}
        errorMessage={t('loadFailed')}
        searchPlaceholder={t('search')}
        emptyState={
          rows.length === 0 ? (
            <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">{t('emptyHint')}</p>
              {createAction ? <div className="mt-4 flex justify-center">{createAction}</div> : null}
            </div>
          ) : undefined
        }
        totals={{
          label: (count) => t('totalRow', { count }),
          columns: { balance: (list) => <MoneyDisplay value={heldByKind(list).total} /> },
        }}
      />

      {editing ? <EditBankAccountDialog bank={editing} onClose={() => setEditing(null)} /> : null}
      {statusChange ? <BankAccountStatusDialog bank={statusChange.bank} to={statusChange.to} onDone={() => setStatusChange(null)} /> : null}
    </div>
  );
}

/** One "New account" button that asks which kind: a bank account, a cash box or an EVC float. */
export function NewAccountMenu({ onPick }: { onPick: (kind: CashAccountPreset | 'blank') => void }) {
  const t = useTranslations('accounting.bankAccounts');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" className="min-h-11">
          <Plus size={16} aria-hidden="true" />
          {t('create.new')}
          <ChevronDown size={16} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onPick('blank')}>{t('kind.BANK')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick('cash-box')}>{t('kind.CASH')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick('evc-float')}>{t('cashPreset.addEvc')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Suspend, reactivate or close an account, saying what each means first. */
export function BankAccountStatusDialog({ bank, to, onDone }: { bank: BankAccount; to: BankAccount['status']; onDone: () => void }) {
  const t = useTranslations('accounting.bankAccounts');
  const setStatus = useSetBankAccountStatus();
  return (
    <ConfirmActionDialog
      title={t(`statusTitle.${to}`, { name: bank.accountName })}
      description={t(`statusBody.${to}`)}
      confirmLabel={t(`statusConfirm.${to}`)}
      destructive={to === 'CLOSED'}
      isPending={setStatus.isPending}
      errorMessage={setStatus.isError ? (setStatus.error instanceof ApiError ? setStatus.error.message : t('loadFailed')) : undefined}
      onConfirm={() => setStatus.mutate({ id: bank.id, status: to }, { onSuccess: onDone })}
      onDismiss={() => {
        setStatus.reset();
        onDone();
      }}
    />
  );
}

/** The account's signatories, managed in a dialog (ADR-039 FormDialog, md). */
export function SignatoriesDialog({ bank, onClose }: { bank: BankAccount; onClose: () => void }) {
  const t = useTranslations('accounting.bankAccounts');
  const tCommon = useTranslations('common');
  return (
    <FormDialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      size="md"
      title={t('signatories.title')}
      subtitle={bank.accountName}
      closeLabel={tCommon('close')}
    >
      <FormDialogBody>
        <SignatoriesPanel bank={bank} />
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline">
            {tCommon('close')}
          </Button>
        </FormDialogClose>
      </FormDialogFooter>
    </FormDialog>
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

      {query.isError && <LoadError message={t('loadFailed')} onRetry={() => void query.refetch()} />}

      {!query.isError && signatories.length === 0 && !query.isPending && (
        <div className="rounded-panel border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
        </div>
      )}

      {signatories.length > 0 && (
        <TableScroll aria-label={t('title')}>
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
                        loading={remove.isPending && remove.variables === s.userId}
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
            loading={add.isPending}
            disabled={!userId.trim() || users.isPending || users.isError}
          >
            {t('add')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Create ──────────────────────────────────────────────────────────────────────

/** A `FormDialog` (ADR-039), size `md`. The caller mounts it to open it. */
export function ConfigureBankAccountForm({
  title,
  preset = null,
  onDone,
}: {
  title: string;
  preset?: CashAccountPreset | null;
  onDone: () => void;
}) {
  const t = useTranslations('accounting.bankAccounts.create');
  const tPreset = useTranslations('accounting.bankAccounts.cashPreset');
  const tKind = useTranslations('accounting.bankAccounts.kind');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const accounts = useAccounts();
  const banks = useBankAccounts();
  const configure = useConfigureBankAccount();

  // A preset is filled once the chart has loaded, so its GL account can be matched.
  const presetDraft = (): BankAccountDraft =>
    preset
      ? cashAccountPreset(
          preset,
          { cashBoxName: tPreset('cashBoxName'), evcName: tPreset('evcName'), evcProvider: tPreset('evcProvider') },
          accounts.data ?? [],
          banks.data ?? [],
        )
      : emptyBankAccountDraft();
  const [initialDraft, setInitialDraft] = useState<BankAccountDraft>(presetDraft);
  const [draft, setDraft] = useState<BankAccountDraft>(initialDraft);
  const [showErrors, setShowErrors] = useState(false);
  const [presetFilledFromChart, setPresetFilled] = useState(Boolean(accounts.data && banks.data));
  if (preset && !presetFilledFromChart && accounts.data && banks.data) {
    const filled = presetDraft();
    setPresetFilled(true);
    setInitialDraft(filled);
    setDraft(filled);
  }

  const ids = {
    bankName: useId(),
    accountName: useId(),
    accountNumber: useId(),
    currency: useId(),
    gl: useId(),
    kind: useId(),
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

  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onDone();
      }}
      title={title}
      size="md"
      dirty={dirty}
      busy={configure.isPending}
      closeLabel={tCommon('close')}
      onSubmit={() => handleSubmit()}
    >
      <FormDialogBody className="space-y-4">
      {/* No GL account left to map: said instead of an empty picker, and nothing to submit. */}
      {availability !== null ? (
        <Alert
          variant={availability === 'all-mapped' ? 'info' : 'error'}
          title={t(`unavailable.${availability}.title`)}
          messages={[t(`unavailable.${availability}.body`)]}
        />
      ) : (
      <>
      {/* A19 — the DTO offers an Arabic name, the column does not exist, and sending it fails
          the request. Said here so the omission does not read as an oversight. */}
      {preset ? <Alert variant="info" messages={[tPreset('formHint')]} /> : null}

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

      <FormField htmlFor={ids.kind} label={t('kind')}>
        <Select id={ids.kind} value={draft.kind} onChange={(value) => patch({ kind: value as BankAccountKind })}>
          {BANK_ACCOUNT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {tKind(kind)}
            </option>
          ))}
        </Select>
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

      </>
      )}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={configure.isPending}>
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button
          type="submit"
          loading={configure.isPending}
          loadingText={tCommon('saving')}
          disabled={availability !== null}
        >
          {t('submit')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
