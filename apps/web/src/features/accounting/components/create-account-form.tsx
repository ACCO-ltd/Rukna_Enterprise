'use client';

/**
 * Adding a GL account (tenant bootstrap, tier 1).
 *
 * The Chart of Accounts screen has been read-only since Sprint 4, which meant a new
 * organisation could not be set up from the UI at all — nothing posts without a chart, and the
 * only way to get one was the seed script or direct SQL.
 *
 * Three things about this form are deliberate and none of them are cosmetic:
 *
 *  1. **The normal balance is defaulted from the class, and an override warns rather than
 *     blocks.** The server checks neither. Getting it wrong inverts the account's sign in every
 *     report while the trial balance still ties — and blocking would make a contra account like
 *     Accumulated Depreciation impossible.
 *  2. **The subtype list is not filtered by class.** The schema's own grouping is wrong for at
 *     least one value, so filtering would hide a legitimate combination. See `coa-setup.ts`.
 *  3. **Every required field is on the form.** `api-reference.md` §6.13 omits two of them (A5),
 *     so anyone building from the reference meets them one 400 at a time.
 *
 * ─── Layout ──────────────────────────────────────────────────────────────────────
 *
 * What names the account comes first, on one panel: name, class, subtype, "Make this a
 * sub-account" (which reveals a parent picker rather than asking for a code typed from memory),
 * then code and start date. Picking a parent fills what is still blank from it — class, subtype,
 * a free code in its block. Whether it accepts postings is a setting row. Normal balance, posting
 * policy and the control-account flags sit behind "Advanced": they are defaulted correctly for
 * almost every account, and the section opens by itself if one of them needs an answer.
 */

import { useId, useMemo, useState } from 'react';
import { ListTree } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  CheckboxField,
  Combobox,
  DatePicker,
  Disclosure,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormDialogSection,
  FormField,
  Input,
  Select,
  SettingRow,
  SettingsGroup,
  Switch,
  type ComboboxOption,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import { accountName, currentVersion } from '../account-display';
import {
  ACCOUNT_CLASSES,
  ACCOUNT_SUBTYPE_GROUPS,
  CONTROL_POSTING_POLICIES,
  SUBLEDGER_TYPES,
  accountDraftProblems,
  conventionalBalance,
  emptyAccountDraft,
  isContraBalance,
  suggestChildCode,
  toCreateAccountBody,
  type AccountDraft,
} from '../coa-setup';
import { useAccounts, useCreateAccount } from '../hooks/use-accounting';
import type { AccountClass, NormalBalance } from '../types';

/** A `FormDialog` (ADR-039), size `lg`: a record form. The caller mounts it to open it. */
export function CreateAccountForm({ title, onDone }: { title: string; onDone: () => void }) {
  const t = useTranslations('accounting.chartOfAccounts.create');
  const tClass = useTranslations('accounting.accountClass');
  const tAcc = useTranslations('accounting.common');
  const tCommon = useTranslations('common');

  const [initialDraft] = useState<AccountDraft>(emptyAccountDraft);
  const [draft, setDraft] = useState<AccountDraft>(initialDraft);
  const [showErrors, setShowErrors] = useState(false);
  const [isSubAccount, setIsSubAccount] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const create = useCreateAccount();
  const accounts = useAccounts();

  const ids = {
    code: useId(),
    name: useId(),
    accountClass: useId(),
    subtype: useId(),
    balance: useId(),
    policy: useId(),
    subledger: useId(),
    postingAllowed: useId(),
    controlAccount: useId(),
    subAccount: useId(),
    parent: useId(),
    effectiveFrom: useId(),
  };

  // Ticked "sub-account" is a statement of intent: submitting without a parent would quietly
  // create a top-level account instead.
  const missingParent = isSubAccount && !draft.parentAccountCode;
  const problems = [...accountDraftProblems(draft), ...(missingParent ? ['parent' as const] : [])];
  const serverError = create.error instanceof ApiError ? create.error.message : null;

  // Any active account can be a parent; listed by code, the order a chart is read in.
  const parentOptions = useMemo<ComboboxOption[]>(
    () =>
      (accounts.data ?? [])
        .filter((account) => account.status === 'ACTIVE')
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((account) => {
          const version = currentVersion(account);
          return {
            value: account.code,
            label: `${account.code} · ${accountName(account)}`,
            hint: version ? tClass(version.accountClass) : undefined,
          };
        }),
    [accounts.data, tClass],
  );

  function patch(next: Partial<AccountDraft>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  /** Choosing a class sets the conventional balance, unless the user has already chosen one. */
  function chooseClass(accountClass: AccountClass | '') {
    patch({
      accountClass,
      ...(accountClass && !draft.normalBalance
        ? { normalBalance: conventionalBalance(accountClass) }
        : {}),
    });
  }

  /**
   * A parent fills what is still blank — never what the user has already chosen: a child's class
   * usually matches its parent's, but a heading can group accounts of more than one subtype.
   */
  function chooseParent(code: string) {
    const all = accounts.data ?? [];
    const parent = all.find((account) => account.code === code);
    const version = parent ? currentVersion(parent) : null;
    const next: Partial<AccountDraft> = { parentAccountCode: code };
    if (parent && version) {
      if (!draft.accountClass) {
        next.accountClass = version.accountClass;
        if (!draft.normalBalance) next.normalBalance = conventionalBalance(version.accountClass);
      }
      if (!draft.accountSubtype) next.accountSubtype = version.accountSubtype;
      if (!draft.code.trim()) {
        const suggested = suggestChildCode(parent, all);
        if (suggested) next.code = suggested;
      }
    }
    patch(next);
  }

  function toggleSubAccount(checked: boolean) {
    setIsSubAccount(checked);
    if (!checked) patch({ parentAccountCode: '' });
  }

  const contra =
    draft.accountClass && draft.normalBalance
      ? isContraBalance(draft.accountClass, draft.normalBalance)
      : false;

  function handleSubmit() {
    setShowErrors(true);
    // An answer needed behind the closed toggle opens it: an error nobody can see goes unfixed.
    if (problems.some((problem) => problem === 'normalBalance' || problem === 'subledgerType')) {
      setAdvancedOpen(true);
    }
    const body = toCreateAccountBody(draft);
    if (!body || missingParent) return;

    create.mutate(body, { onSuccess: onDone });
  }

  function reset() {
    setDraft(initialDraft);
    setIsSubAccount(false);
    setShowErrors(false);
    setAdvancedOpen(false);
    create.reset();
  }

  const dirty = isSubAccount || JSON.stringify(draft) !== JSON.stringify(initialDraft);

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onDone();
      }}
      title={title}
      subtitle={t('subtitle')}
      icon={<ListTree />}
      size="lg"
      dirty={dirty}
      busy={create.isPending}
      closeLabel={tCommon('close')}
      onSubmit={() => handleSubmit()}
    >
      <FormDialogBody>
        <FormDialogSection title={t('sections.account')}>
          <FormField htmlFor={ids.name} label={t('name')}>
            <Input
              id={ids.name}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              maxLength={255}
              autoComplete="off"
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField htmlFor={ids.accountClass} label={t('accountClass')}>
              <Select
                id={ids.accountClass}
                value={draft.accountClass}
                onChange={(value) => chooseClass(value as AccountClass | '')}
              >
                <option value="" disabled>
                  —
                </option>
                {ACCOUNT_CLASSES.map((accountClass) => (
                  <option key={accountClass} value={accountClass}>
                    {tClass(accountClass)}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField htmlFor={ids.subtype} label={t('subtype')}>
              <Select
                id={ids.subtype}
                value={draft.accountSubtype}
                onChange={(value) => patch({ accountSubtype: value })}
              >
                <option value="" disabled>
                  —
                </option>
                {ACCOUNT_SUBTYPE_GROUPS.map(({ group, subtypes }) => (
                  <optgroup key={group} label={t(`subtypeGroup.${group}`)}>
                    {subtypes.map((subtype) => (
                      <option key={subtype} value={subtype}>
                        {t(`subtypeName.${subtype}`)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </FormField>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{t('subtypeHint')}</p>

          <CheckboxField
            id={ids.subAccount}
            label={t('subAccount')}
            description={t('subAccountHint')}
            checked={isSubAccount}
            onChange={(e) => toggleSubAccount(e.target.checked)}
          />

          {isSubAccount ? (
            <FormField htmlFor={ids.parent} label={t('parentAccount')}>
              <Combobox
                id={ids.parent}
                value={draft.parentAccountCode}
                onChange={chooseParent}
                options={parentOptions}
                placeholder={t('parentPlaceholder')}
                searchPlaceholder={t('parentSearch')}
                emptyLabel={t('parentEmpty')}
                loading={accounts.isPending}
                loadingLabel={tCommon('loading')}
              />
              <p className="text-xs text-muted-foreground">{t('parentAccountHint')}</p>
            </FormField>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField htmlFor={ids.code} label={t('code')}>
              <Input
                id={ids.code}
                value={draft.code}
                onChange={(e) => patch({ code: e.target.value })}
                maxLength={30}
                autoComplete="off"
                className="tabular-nums"
              />
              <p className="text-xs text-muted-foreground">{t('codeHint')}</p>
            </FormField>

            <FormField htmlFor={ids.effectiveFrom} label={t('effectiveFrom')}>
              <DatePicker
                id={ids.effectiveFrom}
                value={draft.effectiveFrom}
                onChange={(value) => patch({ effectiveFrom: value })}
              />
              <p className="text-xs text-muted-foreground">{t('effectiveFromHint')}</p>
            </FormField>
          </div>
        </FormDialogSection>

        <SettingsGroup>
          <SettingRow
            htmlFor={ids.postingAllowed}
            label={t('isPostingAllowed')}
            description={t('isPostingAllowedHint')}
          >
            <Switch
              id={ids.postingAllowed}
              aria-describedby={`${ids.postingAllowed}-description`}
              checked={draft.isPostingAllowed}
              onCheckedChange={(checked) => patch({ isPostingAllowed: checked })}
            />
          </SettingRow>
        </SettingsGroup>

        <Disclosure
          label={t('advanced')}
          hint={t('advancedHint')}
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField htmlFor={ids.balance} label={t('normalBalance')}>
              <Select
                id={ids.balance}
                value={draft.normalBalance}
                onChange={(value) => patch({ normalBalance: value as NormalBalance | '' })}
              >
                <option value="" disabled>
                  —
                </option>
                <option value="DEBIT">{tAcc('debit')}</option>
                <option value="CREDIT">{tAcc('credit')}</option>
              </Select>
              {contra ? null : (
                <p className="text-xs text-muted-foreground">{t('normalBalanceHint')}</p>
              )}
            </FormField>

            <FormField htmlFor={ids.policy} label={t('postingPolicy')}>
              <Select
                id={ids.policy}
                value={draft.controlPostingPolicy}
                onChange={(value) =>
                  patch({ controlPostingPolicy: value as AccountDraft['controlPostingPolicy'] })
                }
              >
                {CONTROL_POSTING_POLICIES.map((policy) => (
                  <option key={policy} value={policy}>
                    {t(`policy.${policy}`)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          {/* Full width, under both selects: the warning is too long for a half-width column. */}
          {contra ? <Alert variant="warning" messages={[t('contraWarning')]} /> : null}
          {/* A6. The third policy exists in the schema and the seed uses it for bank and VAT
              accounts; the DTO's @IsEnum omits it. Said here rather than left to be discovered
              by comparing a new account against a seeded one months later. */}
          <p className="text-xs text-muted-foreground">{t('postingPolicyHint')}</p>

          <SettingsGroup>
            <SettingRow
              htmlFor={ids.controlAccount}
              label={t('isControlAccount')}
              description={t('isControlAccountHint')}
            >
              <Switch
                id={ids.controlAccount}
                aria-describedby={`${ids.controlAccount}-description`}
                checked={draft.isControlAccount}
                onCheckedChange={(checked) =>
                  patch({
                    isControlAccount: checked,
                    ...(checked ? {} : { controlledSubledgerType: '' }),
                  })
                }
              />
            </SettingRow>
          </SettingsGroup>

          {draft.isControlAccount ? (
            <FormField htmlFor={ids.subledger} label={t('subledgerType')}>
              <Select
                id={ids.subledger}
                value={draft.controlledSubledgerType}
                onChange={(value) => patch({ controlledSubledgerType: value })}
              >
                <option value="" disabled>
                  —
                </option>
                {SUBLEDGER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`subledger.${type}`)}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
        </Disclosure>

        {showErrors && problems.length > 0 ? (
          <Alert
            variant="error"
            title={t('missingTitle')}
            messages={problems.map((problem) => t(`missing.${problem}`))}
          />
        ) : null}

        {serverError ? <Alert variant="error" messages={[serverError]} /> : null}
      </FormDialogBody>
      <FormDialogFooter
        start={
          dirty ? (
            <Button type="button" variant="ghost" onClick={reset} disabled={create.isPending}>
              {t('reset')}
            </Button>
          ) : null
        }
      >
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={create.isPending}>
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" loading={create.isPending} loadingText={tCommon('saving')}>
          {t('submit')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
