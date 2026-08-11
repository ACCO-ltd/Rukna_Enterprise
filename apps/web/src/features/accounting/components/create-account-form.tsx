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
 */

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input } from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import {
  ACCOUNT_CLASSES,
  ACCOUNT_SUBTYPE_GROUPS,
  CONTROL_POSTING_POLICIES,
  SUBLEDGER_TYPES,
  accountDraftProblems,
  conventionalBalance,
  emptyAccountDraft,
  isContraBalance,
  toCreateAccountBody,
  type AccountDraft,
} from '../coa-setup';
import { useCreateAccount } from '../hooks/use-accounting';
import type { AccountClass, NormalBalance } from '../types';

const SELECT_CLASS =
  'min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm';

export function CreateAccountForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('accounting.chartOfAccounts.create');
  const tClass = useTranslations('accounting.accountClass');
  const tAcc = useTranslations('accounting.common');
  const tCommon = useTranslations('common');

  const [draft, setDraft] = useState<AccountDraft>(emptyAccountDraft());
  const [showErrors, setShowErrors] = useState(false);

  const create = useCreateAccount();

  const ids = {
    code: useId(),
    name: useId(),
    nameAr: useId(),
    accountClass: useId(),
    subtype: useId(),
    balance: useId(),
    policy: useId(),
    subledger: useId(),
    parent: useId(),
    effectiveFrom: useId(),
  };

  const problems = accountDraftProblems(draft);
  const serverError = create.error instanceof ApiError ? create.error.message : null;

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

  const contra =
    draft.accountClass && draft.normalBalance
      ? isContraBalance(draft.accountClass, draft.normalBalance)
      : false;

  function handleSubmit() {
    setShowErrors(true);
    const body = toCreateAccountBody(draft);
    if (!body) return;

    create.mutate(body, { onSuccess: onDone });
  }

  return (
    <div className="space-y-4">
      <FormField htmlFor={ids.code} label={t('code')}>
        <Input
          id={ids.code}
          value={draft.code}
          onChange={(e) => patch({ code: e.target.value })}
          maxLength={30}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{t('codeHint')}</p>
      </FormField>

      <FormField htmlFor={ids.name} label={t('name')}>
        <Input
          id={ids.name}
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          maxLength={255}
          autoComplete="off"
        />
      </FormField>

      <FormField htmlFor={ids.nameAr} label={`${t('nameAr')} (${tCommon('optional')})`}>
        <Input
          id={ids.nameAr}
          value={draft.nameAr}
          onChange={(e) => patch({ nameAr: e.target.value })}
          dir="rtl"
          lang="ar"
          maxLength={255}
          autoComplete="off"
        />
      </FormField>

      <FormField htmlFor={ids.accountClass} label={t('accountClass')}>
        <select
          id={ids.accountClass}
          value={draft.accountClass}
          onChange={(e) => chooseClass(e.target.value as AccountClass | '')}
          className={SELECT_CLASS}
        >
          <option value="" disabled>
            —
          </option>
          {ACCOUNT_CLASSES.map((accountClass) => (
            <option key={accountClass} value={accountClass}>
              {tClass(accountClass)}
            </option>
          ))}
        </select>
      </FormField>

      <FormField htmlFor={ids.subtype} label={t('subtype')}>
        <select
          id={ids.subtype}
          value={draft.accountSubtype}
          onChange={(e) => patch({ accountSubtype: e.target.value })}
          className={SELECT_CLASS}
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
        </select>
        <p className="text-xs text-muted-foreground">{t('subtypeHint')}</p>
      </FormField>

      <FormField htmlFor={ids.balance} label={t('normalBalance')}>
        <select
          id={ids.balance}
          value={draft.normalBalance}
          onChange={(e) => patch({ normalBalance: e.target.value as NormalBalance | '' })}
          className={SELECT_CLASS}
        >
          <option value="" disabled>
            —
          </option>
          <option value="DEBIT">{tAcc('debit')}</option>
          <option value="CREDIT">{tAcc('credit')}</option>
        </select>
        {contra ? (
          <Alert variant="warning" messages={[t('contraWarning')]} />
        ) : (
          <p className="text-xs text-muted-foreground">{t('normalBalanceHint')}</p>
        )}
      </FormField>

      <FormField htmlFor={ids.policy} label={t('postingPolicy')}>
        <select
          id={ids.policy}
          value={draft.controlPostingPolicy}
          onChange={(e) =>
            patch({ controlPostingPolicy: e.target.value as AccountDraft['controlPostingPolicy'] })
          }
          className={SELECT_CLASS}
        >
          {CONTROL_POSTING_POLICIES.map((policy) => (
            <option key={policy} value={policy}>
              {t(`policy.${policy}`)}
            </option>
          ))}
        </select>
        {/* A6. The third policy exists in the schema and the seed uses it for bank and VAT
            accounts; the DTO's @IsEnum omits it. Said here rather than left to be discovered
            by comparing a new account against a seeded one months later. */}
        <p className="text-xs text-muted-foreground">{t('postingPolicyHint')}</p>
      </FormField>

      <fieldset className="space-y-2 rounded-md border border-border p-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">
          {t('flagsLegend')}
        </legend>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.isPostingAllowed}
            onChange={(e) => patch({ isPostingAllowed: e.target.checked })}
            className="size-4"
          />
          {t('isPostingAllowed')}
        </label>
        <p className="text-xs text-muted-foreground">{t('isPostingAllowedHint')}</p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.isControlAccount}
            onChange={(e) =>
              patch({
                isControlAccount: e.target.checked,
                ...(e.target.checked ? {} : { controlledSubledgerType: '' }),
              })
            }
            className="size-4"
          />
          {t('isControlAccount')}
        </label>
        <p className="text-xs text-muted-foreground">{t('isControlAccountHint')}</p>

        {draft.isControlAccount ? (
          <FormField htmlFor={ids.subledger} label={t('subledgerType')}>
            <select
              id={ids.subledger}
              value={draft.controlledSubledgerType}
              onChange={(e) => patch({ controlledSubledgerType: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="" disabled>
                —
              </option>
              {SUBLEDGER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`subledger.${type}`)}
                </option>
              ))}
            </select>
          </FormField>
        ) : null}
      </fieldset>

      <FormField
        htmlFor={ids.parent}
        label={`${t('parentCode')} (${tCommon('optional')})`}
      >
        <Input
          id={ids.parent}
          value={draft.parentAccountCode}
          onChange={(e) => patch({ parentAccountCode: e.target.value })}
          maxLength={30}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{t('parentCodeHint')}</p>
      </FormField>

      <FormField htmlFor={ids.effectiveFrom} label={t('effectiveFrom')}>
        <Input
          id={ids.effectiveFrom}
          type="date"
          value={draft.effectiveFrom}
          onChange={(e) => patch({ effectiveFrom: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('effectiveFromHint')}</p>
      </FormField>

      {showErrors && problems.length > 0 ? (
        <Alert
          variant="error"
          title={t('missingTitle')}
          messages={problems.map((problem) => t(`missing.${problem}`))}
        />
      ) : null}

      {serverError ? <Alert variant="error" messages={[serverError]} /> : null}

      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={create.isPending}>
          {tCommon('cancel')}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={create.isPending}>
          {create.isPending ? tCommon('saving') : t('submit')}
        </Button>
      </div>
    </div>
  );
}
