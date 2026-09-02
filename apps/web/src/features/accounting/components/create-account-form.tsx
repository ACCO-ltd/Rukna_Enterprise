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
import { Alert, Button, CheckboxField, DatePicker, FormField, Input, Select } from '@erp/ui';

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
    accountClass: useId(),
    subtype: useId(),
    balance: useId(),
    policy: useId(),
    subledger: useId(),
    postingAllowed: useId(),
    controlAccount: useId(),
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
        <p className="text-xs text-muted-foreground">{t('subtypeHint')}</p>
      </FormField>

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
        {contra ? (
          <Alert variant="warning" messages={[t('contraWarning')]} />
        ) : (
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
        {/* A6. The third policy exists in the schema and the seed uses it for bank and VAT
            accounts; the DTO's @IsEnum omits it. Said here rather than left to be discovered
            by comparing a new account against a seeded one months later. */}
        <p className="text-xs text-muted-foreground">{t('postingPolicyHint')}</p>
      </FormField>

      <fieldset className="space-y-1 rounded-panel border border-border p-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">
          {t('flagsLegend')}
        </legend>

        <CheckboxField
          id={ids.postingAllowed}
          label={t('isPostingAllowed')}
          description={t('isPostingAllowedHint')}
          checked={draft.isPostingAllowed}
          onChange={(e) => patch({ isPostingAllowed: e.target.checked })}
        />

        <CheckboxField
          id={ids.controlAccount}
          label={t('isControlAccount')}
          description={t('isControlAccountHint')}
          checked={draft.isControlAccount}
          onChange={(e) =>
            patch({
              isControlAccount: e.target.checked,
              ...(e.target.checked ? {} : { controlledSubledgerType: '' }),
            })
          }
        />

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
        <DatePicker
          id={ids.effectiveFrom}
          value={draft.effectiveFrom}
          onChange={(value) => patch({ effectiveFrom: value })}
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
