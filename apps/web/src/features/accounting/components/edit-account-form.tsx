'use client';

/**
 * Editing a GL account (`PATCH /accounts/:id`).
 *
 * The Chart of Accounts was create-and-import only; a misspelt name or a wrong parent could not be
 * corrected from the UI at all. This form exposes exactly the fields the endpoint accepts and no
 * more:
 *
 *  1. **Name, posting-allowed and parent only.** Class, subtype and the control-role are absent by
 *     design — the server does not accept them here, because reclassifying an account that already
 *     has postings changes how prior years roll up and is a domain decision, not a form toggle.
 *  2. **Parent is a select of existing codes with a "none" option.** Re-parenting to none is sent as
 *     an empty string — the convention the server reads as "detach". An account cannot be its own
 *     parent, so it is excluded from its own list.
 *  3. **Only changed fields are sent** (`toUpdateAccountBody`), so an edit that touches only the name
 *     does not silently re-parent or flip the posting flag.
 */

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  CheckboxField,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Input,
  Select,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import { accountName, currentVersion } from '../account-display';
import {
  editAccountDraftFrom,
  editAccountProblem,
  toUpdateAccountBody,
  type EditAccountDraft,
} from '../coa-setup';
import { useAccounts, useUpdateAccount } from '../hooks/use-accounting';
import type { Account } from '../types';

/** A `FormDialog` (ADR-039), size `md`: four fields. The caller mounts it to open it. */
export function EditAccountForm({
  title,
  account,
  onDone,
}: {
  title: string;
  account: Account;
  onDone: () => void;
}) {
  const t = useTranslations('accounting.chartOfAccounts.edit');
  const tCommon = useTranslations('common');

  const accounts = useAccounts();
  const update = useUpdateAccount();

  // The original snapshot is captured once from the account this form opened on, so a background
  // refetch of the chart does not shift what "changed" is measured against mid-edit.
  const original = useMemo<EditAccountDraft>(
    () => editAccountDraftFrom(account, accounts.data ?? []),
    [account, accounts.data],
  );
  const [draft, setDraft] = useState<EditAccountDraft>(original);
  const [showErrors, setShowErrors] = useState(false);

  const ids = {
    name: useId(),
    postingAllowed: useId(),
    parent: useId(),
    reason: useId(),
  };

  // Every other account is a candidate parent; an account cannot parent itself.
  const parentCandidates = useMemo(
    () =>
      (accounts.data ?? [])
        .filter((candidate) => candidate.id !== account.id && currentVersion(candidate))
        .sort((a, b) => a.code.localeCompare(b.code)),
    [accounts.data, account.id],
  );

  const problem = editAccountProblem(draft);
  const serverError = update.error instanceof ApiError ? update.error.message : null;

  function patch(next: Partial<EditAccountDraft>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  function handleSubmit() {
    setShowErrors(true);
    if (problem) return;

    const body = toUpdateAccountBody(draft, original);
    // Nothing changed — close rather than fire a no-op request.
    if (!body) {
      onDone();
      return;
    }

    update.mutate({ id: account.id, body }, { onSuccess: onDone });
  }

  // The raw form against what it opened with: a cleared name or a typed reason is an edit worth
  // asking about even though neither would produce a request body.
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onDone();
      }}
      title={title}
      size="md"
      dirty={dirty}
      busy={update.isPending}
      closeLabel={tCommon('close')}
      onSubmit={() => handleSubmit()}
    >
      <FormDialogBody className="space-y-4">
      <FormField htmlFor={ids.name} label={t('name')}>
        <Input
          id={ids.name}
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          maxLength={255}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          {t('codeFixed', { code: account.code })}
        </p>
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
      </fieldset>

      <FormField htmlFor={ids.parent} label={t('parent')}>
        <Select
          id={ids.parent}
          value={draft.parentAccountCode}
          onChange={(value) => patch({ parentAccountCode: value })}
        >
          <option value="">{t('parentNone')}</option>
          {parentCandidates.map((candidate) => (
            <option key={candidate.id} value={candidate.code}>
              {candidate.code} · {accountName(candidate)}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">{t('parentHint')}</p>
      </FormField>

      <FormField htmlFor={ids.reason} label={`${t('reason')} (${tCommon('optional')})`}>
        <Input
          id={ids.reason}
          value={draft.changeReason}
          onChange={(e) => patch({ changeReason: e.target.value })}
          maxLength={255}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{t('reasonHint')}</p>
      </FormField>

      {showErrors && problem ? (
        <Alert variant="error" messages={[t(`missing.${problem}`)]} />
      ) : null}

      {serverError ? <Alert variant="error" messages={[serverError]} /> : null}

      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={update.isPending}>
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? tCommon('saving') : t('submit')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
