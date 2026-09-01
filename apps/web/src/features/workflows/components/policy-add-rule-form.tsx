'use client';

import { type FormEvent, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input, Select } from '@erp/ui';

import { useRoles } from '@/features/roles/hooks/use-roles';
import { ApiError } from '@/lib/api-client';
import { useAddApprovalPolicyRule } from '../hooks/use-approval-policies';
import { AUTHORABLE_TRANSACTION_TYPES, policyMatrixFor } from '../policy-matrix';

/**
 * Adds a rule to a DRAFT policy — the affordance that was missing entirely, leaving a fresh
 * draft with no way to gain rules.
 *
 * Consumes `useAddApprovalPolicyRule` → `POST /workflows/policies/:id/rules`.
 *
 * Two matrix constraints are enforced here rather than left to the server's 400:
 *  - `transactionType` is limited to the four authorable types (`AUTHORABLE_TRANSACTION_TYPES`).
 *  - `fromState`/`toState` are pinned to the one approved transition for the chosen type, shown
 *    read-only. Free-texting them would produce a rule the server rejects with
 *    "This transaction and lifecycle transition are not approved for ACCO policy authoring".
 *
 * `requiredRole` is picked from live org roles; the server matches it by exact name and answers
 * 409 when it does not exist, so sending a value the user typed is never offered.
 */
export function PolicyAddRuleForm({ policyId }: { policyId: string }) {
  const t = useTranslations('platform.workflows.policies.addRule');
  const roles = useRoles();
  const add = useAddApprovalPolicyRule();

  const [transactionType, setTransactionType] = useState<string>(AUTHORABLE_TRANSACTION_TYPES[0] ?? '');
  const [ruleKey, setRuleKey] = useState('');
  const [requiredRole, setRequiredRole] = useState('');
  const [priority, setPriority] = useState('0');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  const matrix = policyMatrixFor(transactionType);
  const bandsApply = matrix?.basis !== null;

  const priorityNumber = Number(priority);
  const priorityInvalid = priority.trim() !== '' && (!Number.isFinite(priorityNumber) || priorityNumber < 0);
  const bandInvalid = useMemo(() => {
    if (!minAmount.trim() || !maxAmount.trim()) return false;
    const lo = Number(minAmount);
    const hi = Number(maxAmount);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
    return lo > hi;
  }, [minAmount, maxAmount]);

  const canSubmit =
    Boolean(ruleKey.trim()) &&
    Boolean(requiredRole) &&
    Boolean(matrix) &&
    !priorityInvalid &&
    !bandInvalid &&
    !add.isPending;

  function reset() {
    setRuleKey('');
    setRequiredRole('');
    setPriority('0');
    setMinAmount('');
    setMaxAmount('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matrix || !canSubmit) return;
    add.mutate(
      {
        id: policyId,
        ruleKey: ruleKey.trim(),
        transactionType,
        requiredRole,
        priority: priorityNumber,
        ...(bandsApply && minAmount.trim() ? { minAmount: minAmount.trim() } : {}),
        ...(bandsApply && maxAmount.trim() ? { maxAmount: maxAmount.trim() } : {}),
        fromState: matrix.fromState,
        toState: matrix.toState,
      },
      { onSuccess: () => reset() },
    );
  }

  const addError =
    add.error instanceof ApiError && add.error.messages.length > 0
      ? add.error.messages
      : add.isError
        ? [t('failed')]
        : null;

  return (
    <form onSubmit={submit} className="space-y-4">
      <FormField htmlFor="add-rule-tx" label={t('transactionType')} required>
        <Select
          id="add-rule-tx"
          value={transactionType}
          onChange={(event) => setTransactionType(event.target.value)}
        >
          {AUTHORABLE_TRANSACTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {policyMatrixFor(type)?.label ?? type}
            </option>
          ))}
        </Select>
      </FormField>

      {matrix ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-panel border border-border bg-surface-subtle px-3.5 py-3 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            {t('approvedTransition')}
          </dt>
          <dd className="font-mono text-foreground">{matrix.transition}</dd>
          <dt className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            {t('basis')}
          </dt>
          <dd className="text-foreground">{matrix.basis ?? '—'}</dd>
          <dt className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            {t('chain')}
          </dt>
          <dd className="text-foreground">{matrix.chain}</dd>
        </dl>
      ) : null}

      <FormField htmlFor="add-rule-key" label={t('ruleKey')} hint={t('ruleKeyHint')} required>
        <Input
          id="add-rule-key"
          value={ruleKey}
          onChange={(event) => setRuleKey(event.target.value)}
          placeholder="PO_BAND_0_10K"
          maxLength={80}
        />
      </FormField>

      <FormField htmlFor="add-rule-role" label={t('requiredRole')} required>
        <Select
          id="add-rule-role"
          value={requiredRole}
          onChange={(event) => setRequiredRole(event.target.value)}
          disabled={roles.isPending}
        >
          <option value="" disabled>
            {roles.isPending ? t('rolesLoading') : t('selectRole')}
          </option>
          {(roles.data ?? []).map((role) => (
            <option key={role.id} value={role.name}>
              {role.name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        htmlFor="add-rule-priority"
        label={t('priority')}
        hint={t('priorityHint')}
        error={priorityInvalid ? t('priorityInvalid') : undefined}
        required
      >
        <Input
          id="add-rule-priority"
          type="number"
          min={0}
          step={1}
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
        />
      </FormField>

      {bandsApply ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField htmlFor="add-rule-min" label={t('minAmount')}>
            <Input
              id="add-rule-min"
              inputMode="decimal"
              value={minAmount}
              onChange={(event) => setMinAmount(event.target.value)}
              placeholder="0"
            />
          </FormField>
          <FormField
            htmlFor="add-rule-max"
            label={t('maxAmount')}
            error={bandInvalid ? t('bandInvalid') : undefined}
          >
            <Input
              id="add-rule-max"
              inputMode="decimal"
              value={maxAmount}
              onChange={(event) => setMaxAmount(event.target.value)}
              placeholder="10000"
            />
          </FormField>
        </div>
      ) : (
        <p className="text-caption text-muted-foreground">{t('noBands')}</p>
      )}

      {addError ? <Alert variant="error" messages={addError} /> : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit}>
          {add.isPending ? t('adding') : t('add')}
        </Button>
      </div>
    </form>
  );
}
