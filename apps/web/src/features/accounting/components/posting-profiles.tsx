'use client';

/**
 * Posting profiles (ADR-040 §4).
 *
 * A profile maps a stable code — what a supplier bill line names — onto the GL account it posts
 * to. Until ADR-040 they were read-only and created only by the seed, so an organisation the seed
 * never ran against could not raise a supplier bill.
 *
 * `view:accounting` reads the list; `manage:accounting` creates, re-points and (de)activates.
 * Re-pointing adds an effective-dated version; the previous version is kept, so a document
 * posted before the change still resolves to the account it used.
 */

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  ConfirmDialog,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Input,
  OverflowGlyph,
  RowActions,
  Select,
  StatusPill,
} from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { statusTone } from '@/lib/status-registry';

import { accountName, currentVersion } from '../account-display';
import {
  useAccounts,
  useCreatePostingProfile,
  usePostingProfiles,
  useRepointPostingProfile,
  useSetPostingProfileActive,
} from '../hooks/use-accounting';
import {
  createProfileProblems,
  earliestRepointDate,
  latestProfileVersion,
  profileCodeFromName,
  profileTarget,
  profileVersionOn,
  PROFILE_TARGET_CLASSES,
  profileTargetAccounts,
  repointProblems,
  scheduledVersion,
  shiftIsoDate,
  toCreateProfileBody,
  todayIso,
} from '../posting-profile-setup';
import type { Account, AccountClass, PostingProfile } from '../types';

interface ProfileTargetView {
  code: string;
  name: string | null;
  accountClass: AccountClass | null;
}
import { AccountClassBadge } from './account-badges';

export function PostingProfiles() {
  const t = useTranslations('accounting.postingProfiles');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();
  const mayManage = can(ACCOUNTING_PERMISSIONS.manageChart);

  const profiles = usePostingProfiles();
  const accounts = useAccounts();
  const status = useSetPostingProfileActive();

  const [creating, setCreating] = useState(false);
  const [repointing, setRepointing] = useState<PostingProfile | null>(null);
  const [toggling, setToggling] = useState<PostingProfile | null>(null);

  const accountById = useMemo(
    () => new Map((accounts.data ?? []).map((account) => [account.id, account])),
    [accounts.data],
  );

  const today = todayIso();

  /**
   * What the profile points at today. The server resolves it (`currentAccount`, or the in-force
   * version's own label); the chart fills in whatever it leaves out.
   */
  const targetOf = (profile: PostingProfile): ProfileTargetView | null => {
    const server = profileTarget(profile, today);
    const version = server ? null : profileVersionOn(profile, today);
    const accountId = server?.accountId ?? version?.accountId;
    const local = accountId ? accountById.get(accountId) : undefined;
    const code = server?.code ?? local?.code;
    if (!code) return null;
    return {
      code,
      name: server?.name ?? (local ? accountName(local) : null),
      accountClass:
        server?.accountClass ?? (local ? (currentVersion(local)?.accountClass ?? null) : null),
    };
  };

  /** A re-point that has not taken effect yet, labelled with its account's code. */
  const scheduledOf = (profile: PostingProfile): { date: string; code: string } | null => {
    const version = scheduledVersion(profile, today);
    if (!version) return null;
    const code = version.accountCode ?? accountById.get(version.accountId)?.code;
    return code ? { date: formatDate(version.effectiveFrom) ?? version.effectiveFrom, code } : null;
  };

  const inForceFrom = (profile: PostingProfile): string | null =>
    (profileVersionOn(profile, today) ?? latestProfileVersion(profile))?.effectiveFrom ?? null;

  const columns: GridColumn<PostingProfile>[] = [
    {
      key: 'code',
      header: t('colCode'),
      sticky: true,
      sortable: true,
      plainValue: (profile) => profile.code,
      render: (profile) => (
        <span className="font-mono text-caption tabular-nums">{profile.code}</span>
      ),
    },
    {
      key: 'name',
      header: t('colName'),
      sortable: true,
      plainValue: (profile) => latestProfileVersion(profile)?.name ?? '',
      render: (profile) => (
        <span className="text-sm text-foreground">
          {latestProfileVersion(profile)?.name ?? '—'}
        </span>
      ),
    },
    {
      key: 'account',
      header: t('colAccount'),
      sortable: true,
      plainValue: (profile) => targetOf(profile)?.code ?? '',
      render: (profile) => {
        const target = targetOf(profile);
        const scheduled = scheduledOf(profile);
        return (
          <div className="space-y-0.5">
            {target ? (
              <span className="text-sm text-foreground">
                <span className="font-mono text-caption tabular-nums">{target.code}</span>
                {target.name ? ` · ${target.name}` : ''}
              </span>
            ) : accounts.isPending ? (
              <span className="text-sm text-muted-foreground">…</span>
            ) : (
              <span className="text-sm italic text-muted-foreground">
                {scheduled ? t('notInForce') : t('unknownAccount')}
              </span>
            )}
            {scheduled ? (
              <p className="text-caption text-muted-foreground">{t('scheduled', scheduled)}</p>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'class',
      header: t('colClass'),
      render: (profile) => {
        const accountClass = targetOf(profile)?.accountClass;
        return accountClass ? <AccountClassBadge accountClass={accountClass} /> : null;
      },
    },
    {
      key: 'effectiveFrom',
      header: t('colEffectiveFrom'),
      sortable: true,
      plainValue: (profile) => inForceFrom(profile) ?? '',
      render: (profile) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatDate(inForceFrom(profile)) ?? '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('colStatus'),
      render: (profile) => (
        <StatusPill tone={statusTone(profile.status, 'masterData')}>
          {t(`status.${profile.status}`)}
        </StatusPill>
      ),
    },
  ];

  const createAction = mayManage ? (
    <Button type="button" onClick={() => setCreating(true)}>
      {t('create.new')}
    </Button>
  ) : null;

  const statusError =
    status.isError && status.variables
      ? t('actionFailed', {
          code: status.variables.code,
          message: status.error instanceof ApiError ? status.error.message : t('loadFailed'),
        })
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-h2 font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{t('description')}</p>
      </div>

      {statusError ? <Alert variant="error" messages={[statusError]} /> : null}

      <PlatformDataGrid
        columns={columns}
        data={profiles.data ?? []}
        rowKey={(profile) => profile.id}
        label={t('title')}
        isLoading={profiles.isPending}
        isError={profiles.isError}
        onRetry={() => void profiles.refetch()}
        errorMessage={t('loadFailed')}
        emptyState={
          (profiles.data?.length ?? 0) === 0 ? (
            <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
                {t('emptyHint')}
              </p>
              {createAction ? <div className="mt-4 flex justify-center">{createAction}</div> : null}
            </div>
          ) : undefined
        }
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 50 }}
        toolbarActions={createAction}
        rowActions={
          mayManage
            ? (profile) => {
                const active = profile.status === 'ACTIVE';
                return (
                  <RowActions
                    overflow={
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('rowMenu', { code: profile.code })}
                          >
                            <OverflowGlyph />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setToggling(profile)}>
                            {active ? t('deactivate.action') : t('reactivate.action')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    }
                  >
                    {active ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRepointing(profile)}
                        aria-label={`${t('repoint.action')} ${profile.code}`}
                      >
                        {t('repoint.action')}
                      </Button>
                    ) : null}
                  </RowActions>
                );
              }
            : undefined
        }
      />

      {!mayManage ? (
        <p className="max-w-prose text-xs text-muted-foreground">{t('readOnlyNote')}</p>
      ) : null}

      {creating ? (
        <CreatePostingProfileForm
          accounts={accounts.data ?? []}
          accountsPending={accounts.isPending}
          takenCodes={new Set((profiles.data ?? []).map((profile) => profile.code))}
          onDone={() => setCreating(false)}
        />
      ) : null}

      {repointing ? (
        <RepointPostingProfileForm
          key={repointing.id}
          profile={repointing}
          current={targetOf(repointing)}
          latestAccountCode={(() => {
            const latest = latestProfileVersion(repointing);
            if (!latest) return null;
            return latest.accountCode ?? accountById.get(latest.accountId)?.code ?? null;
          })()}
          accounts={accounts.data ?? []}
          onDone={() => setRepointing(null)}
        />
      ) : null}

      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(open) => {
          if (!open) setToggling(null);
        }}
        variant={toggling?.status === 'ACTIVE' ? 'destructive' : 'default'}
        title={
          toggling
            ? toggling.status === 'ACTIVE'
              ? t('deactivate.title', { code: toggling.code })
              : t('reactivate.title', { code: toggling.code })
            : ''
        }
        description={toggling?.status === 'ACTIVE' ? t('deactivate.body') : t('reactivate.body')}
        confirmLabel={
          toggling?.status === 'ACTIVE' ? t('deactivate.confirm') : t('reactivate.confirm')
        }
        cancelLabel={tCommon('cancel')}
        isPending={status.isPending}
        onConfirm={() => {
          if (!toggling) return;
          const target = toggling;
          status.mutate(
            { id: target.id, code: target.code, active: target.status !== 'ACTIVE' },
            { onSettled: () => setToggling(null) },
          );
        }}
      />
    </div>
  );
}

// ─── Account picker ──────────────────────────────────────────────────────────────

interface AccountOption {
  value: string;
  label: string;
  accountClass: AccountClass | null;
}

function useAccountOptions(accounts: readonly Account[]): AccountOption[] {
  return useMemo(
    () =>
      profileTargetAccounts(accounts).map((account) => ({
        value: account.code,
        label: `${account.code} · ${accountName(account)}`,
        accountClass: currentVersion(account)?.accountClass ?? null,
      })),
    [accounts],
  );
}

/**
 * A searchable account picker that works inside a modal dialog: a filter field narrowing a
 * `Select` grouped by class.
 *
 * Not `Combobox` (nor a `Select` long enough to become one): its list is portalled outside the
 * dialog, beneath the overlay and outside the dialog's focus trap, so inside a `FormDialog` it
 * can be neither clicked nor searched. `Select` is a Radix layer and cooperates with the dialog.
 */
function AccountPicker({
  id,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly AccountOption[];
  disabled?: boolean;
}) {
  const t = useTranslations('accounting.postingProfiles.create');
  const tClass = useTranslations('accounting.accountClass');
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  // The chosen account stays listed whatever the filter, so the field never shows a value its
  // own list does not contain.
  const shown = options.filter(
    (option) => !q || option.value === value || option.label.toLowerCase().includes(q),
  );
  const groups = PROFILE_TARGET_CLASSES.map((accountClass) => ({
    accountClass,
    options: shown.filter((option) => option.accountClass === accountClass),
  })).filter((group) => group.options.length > 0);

  return (
    <div className="space-y-2">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('accountSearch')}
        aria-label={t('accountSearch')}
        aria-invalid={false}
        aria-describedby={undefined}
        disabled={disabled}
        autoComplete="off"
      />
      <Select id={id} searchable={false} value={value} onChange={onChange} disabled={disabled}>
        <option value="" disabled>
          {t('accountPlaceholder')}
        </option>
        {groups.map((group) => (
          <optgroup key={group.accountClass} label={tClass(group.accountClass)}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      {q && shown.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t('accountEmpty')}</p>
      ) : null}
    </div>
  );
}

// ─── New posting profile ─────────────────────────────────────────────────────────

/** A `FormDialog` (ADR-039), size `md`. The caller mounts it to open it. */
export function CreatePostingProfileForm({
  accounts,
  accountsPending,
  takenCodes,
  onDone,
}: {
  accounts: readonly Account[];
  accountsPending: boolean;
  takenCodes: ReadonlySet<string>;
  onDone: () => void;
}) {
  const t = useTranslations('accounting.postingProfiles.create');
  const tCommon = useTranslations('common');
  const ids = { name: useId(), code: useId(), account: useId(), from: useId() };

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  // Once the person edits the code it stops following the name.
  const [codeEdited, setCodeEdited] = useState(false);
  const [accountCode, setAccountCode] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  const create = useCreatePostingProfile();
  const options = useAccountOptions(accounts);

  const draft = { name, code, accountCode, effectiveFrom };
  const problems = createProfileProblems(draft, takenCodes);
  const shown = showErrors ? problems : [];

  // The server's message names the account and why it cannot take a profile, so it is shown as
  // is; a taken code is said in the form's own words, next to the field it concerns.
  const serverError = !create.isError
    ? null
    : create.error instanceof ApiError && create.error.code === 'POSTING_PROFILE_CODE_TAKEN'
      ? t('problem.code-taken')
      : create.error instanceof ApiError && create.error.message
        ? create.error.message
        : t('accountInvalid');

  const noAccounts = !accountsPending && options.length === 0;

  function handleSubmit() {
    setShowErrors(true);
    if (problems.length > 0) return;
    create.mutate(toCreateProfileBody(draft), { onSuccess: onDone });
  }

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onDone();
      }}
      title={t('title')}
      size="md"
      dirty={name !== '' || code !== '' || accountCode !== '' || effectiveFrom !== ''}
      busy={create.isPending}
      closeLabel={tCommon('close')}
      onSubmit={() => handleSubmit()}
    >
      <FormDialogBody className="space-y-4">
        {noAccounts ? <Alert variant="error" messages={[t('noAccounts')]} /> : null}

        <FormField
          htmlFor={ids.name}
          label={t('name')}
          error={shown.includes('name') ? t('problem.name') : undefined}
        >
          <Input
            id={ids.name}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!codeEdited) setCode(profileCodeFromName(e.target.value));
            }}
            maxLength={100}
            autoComplete="off"
          />
        </FormField>

        <FormField
          htmlFor={ids.code}
          label={t('code')}
          hint={t('codeHint')}
          error={
            shown.includes('code')
              ? t('problem.code')
              : shown.includes('code-taken')
                ? t('problem.code-taken')
                : undefined
          }
        >
          <Input
            id={ids.code}
            value={code}
            onChange={(e) => {
              setCodeEdited(true);
              setCode(e.target.value.toUpperCase());
            }}
            maxLength={50}
            autoComplete="off"
            className="font-mono"
          />
        </FormField>

        <FormField
          htmlFor={ids.account}
          label={t('account')}
          hint={t('accountHint')}
          error={shown.includes('account') ? t('problem.account') : undefined}
        >
          <AccountPicker
            id={ids.account}
            value={accountCode}
            onChange={setAccountCode}
            options={options}
            disabled={noAccounts}
          />
        </FormField>

        <FormField
          htmlFor={ids.from}
          label={`${t('effectiveFrom')} (${tCommon('optional')})`}
          hint={t('effectiveFromHint')}
        >
          <DatePicker id={ids.from} value={effectiveFrom} onChange={setEffectiveFrom} />
        </FormField>

        {serverError ? <Alert variant="error" messages={[serverError]} /> : null}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={create.isPending}>
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button
          type="submit"
          loading={create.isPending}
          loadingText={tCommon('saving')}
          disabled={noAccounts}
        >
          {t('submit')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}

// ─── Re-point ────────────────────────────────────────────────────────────────────

/** A `FormDialog` (ADR-039), size `md`. Adds a new effective-dated version. */
export function RepointPostingProfileForm({
  profile,
  current,
  latestAccountCode,
  accounts,
  onDone,
}: {
  profile: PostingProfile;
  /** What the profile points at today, for the subtitle. */
  current: ProfileTargetView | null;
  /** The latest version's account — a re-point to it again changes nothing. */
  latestAccountCode: string | null;
  accounts: readonly Account[];
  onDone: () => void;
}) {
  const t = useTranslations('accounting.postingProfiles.repoint');
  const tCreate = useTranslations('accounting.postingProfiles.create');
  const tCommon = useTranslations('common');
  const ids = { account: useId(), from: useId() };

  const latestFrom = latestProfileVersion(profile)?.effectiveFrom.slice(0, 10) ?? null;
  // A new version must start after the latest one; the earliest such day, or today, is the default.
  const earliest = earliestRepointDate(latestFrom, todayIso());

  const [accountCode, setAccountCode] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(earliest);
  const [showErrors, setShowErrors] = useState(false);

  const repoint = useRepointPostingProfile();
  const options = useAccountOptions(accounts);

  const problems = repointProblems(
    { accountCode, effectiveFrom },
    { accountCode: latestAccountCode, effectiveFrom: latestFrom },
  );
  const shown = showErrors ? problems : [];
  const dateOk = !problems.includes('effective-from') && !problems.includes('effective-from-early');

  const serverError = repoint.isError
    ? repoint.error instanceof ApiError && repoint.error.message
      ? repoint.error.message
      : tCreate('accountInvalid')
    : null;

  function handleSubmit() {
    setShowErrors(true);
    if (problems.length > 0) return;
    repoint.mutate({ id: profile.id, body: { accountCode, effectiveFrom } }, { onSuccess: onDone });
  }

  const currentLabel = current
    ? current.name
      ? `${current.code} · ${current.name}`
      : current.code
    : '—';

  const dateError = shown.includes('effective-from')
    ? t('problem.effective-from')
    : shown.includes('effective-from-early') && latestFrom
      ? t('problem.effective-from-early', { date: formatDate(latestFrom) ?? latestFrom })
      : undefined;

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onDone();
      }}
      title={t('title', { code: profile.code })}
      subtitle={t('current', { account: currentLabel })}
      size="md"
      dirty={accountCode !== '' || effectiveFrom !== earliest}
      busy={repoint.isPending}
      closeLabel={tCommon('close')}
      onSubmit={() => handleSubmit()}
    >
      <FormDialogBody className="space-y-4">
        <FormField
          htmlFor={ids.account}
          label={t('account')}
          error={
            shown.includes('account')
              ? t('problem.account')
              : shown.includes('same-account')
                ? t('problem.same-account')
                : undefined
          }
        >
          <AccountPicker
            id={ids.account}
            value={accountCode}
            onChange={setAccountCode}
            options={options}
          />
        </FormField>

        <FormField
          htmlFor={ids.from}
          label={t('effectiveFrom')}
          error={dateError}
          hint={
            dateOk
              ? t('untilDay', {
                  date:
                    formatDate(shiftIsoDate(effectiveFrom, -1)) ?? shiftIsoDate(effectiveFrom, -1),
                })
              : undefined
          }
        >
          <DatePicker
            id={ids.from}
            value={effectiveFrom}
            onChange={setEffectiveFrom}
            min={latestFrom ? shiftIsoDate(latestFrom, 1) : undefined}
          />
        </FormField>

        <Alert variant="info" messages={[t('history')]} />

        {serverError ? <Alert variant="error" messages={[serverError]} /> : null}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={repoint.isPending}>
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" loading={repoint.isPending} loadingText={tCommon('saving')}>
          {t('submit')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
