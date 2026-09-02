'use client';

import { type FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormField,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { useSimulateApprovalPolicyDraft } from '../hooks/use-approval-policies';
import { AUTHORABLE_TRANSACTION_TYPES, policyMatrixFor } from '../policy-matrix';

/**
 * Policy simulation panel — a read-only dry-run of a DRAFT policy against one transaction.
 *
 * Consumes `useSimulateApprovalPolicyDraft` → `POST /workflows/policies/:id/simulate`, which
 * computes (server-side) which rules would fire, the resulting approval chain, whether the chain is
 * `ambiguous`, and every rejected rule with the reasons it was excluded. No approval instance or
 * transaction is created — this is authoring feedback, so an author can see *why* a draft behaves
 * as it does before scheduling it.
 *
 * Inputs mirror the add-rule form's matrix constraint: transaction type is limited to the four
 * authorable types, and `fromState`/`toState` are pinned to the one approved transition for the
 * chosen type (shown read-only), matching what the rules were authored against. Amount is optional —
 * omitting it ignores the bands, which is how you check the un-banded chain.
 *
 * Only mounted for a draft the caller may author; the parent gates on `manage:workflow` before
 * rendering it. `hasRules` disables the run when the draft is empty (the endpoint would return a
 * bare no-match), and the panel shows an explicit empty prompt instead.
 *
 * States covered: idle · empty (no rules) · running (button) · error · no-match · clean match ·
 * ambiguous · rejected-with-reasons.
 */
export function PolicySimulationPanel({
  policyId,
  hasRules,
}: {
  policyId: string;
  hasRules: boolean;
}) {
  const t = useTranslations('platform.workflows.policies.simulate');
  const simulate = useSimulateApprovalPolicyDraft();

  const [transactionType, setTransactionType] = useState<string>(
    AUTHORABLE_TRANSACTION_TYPES[0] ?? '',
  );
  const [amount, setAmount] = useState('');

  const matrix = policyMatrixFor(transactionType);
  const bandsApply = matrix?.basis !== null;

  function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matrix || !hasRules) return;
    simulate.mutate({
      id: policyId,
      transactionType,
      // Transition is pinned to the approved matrix pair, not free-text — the same states the
      // rules were authored against, so a match reflects the real chain rather than a typo.
      fromState: matrix.fromState,
      toState: matrix.toState,
      ...(bandsApply && amount.trim() ? { amount: amount.trim() } : {}),
    });
  }

  const runError =
    simulate.error instanceof ApiError && simulate.error.messages.length > 0
      ? simulate.error.messages
      : simulate.isError
        ? [t('failed')]
        : null;

  const result = simulate.data;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{t('heading')}</h3>
        <p className="mt-1 text-caption text-muted-foreground">{t('intro')}</p>
      </div>

      {!hasRules ? (
        <p className="rounded-panel border border-border bg-surface-subtle px-3.5 py-3 text-sm text-muted-foreground">
          {t('noRules')}
        </p>
      ) : null}

      <form onSubmit={run} className="space-y-4">
        <FormField htmlFor="sim-tx" label={t('transactionType')} required>
          <Select
            id="sim-tx"
            value={transactionType}
            onChange={(value) => setTransactionType(value)}
          >
            {AUTHORABLE_TRANSACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {policyMatrixFor(type)?.label ?? type}
              </option>
            ))}
          </Select>
        </FormField>

        {matrix ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
              {t('transition')}
            </dt>
            <dd className="font-mono text-foreground">{matrix.transition}</dd>
          </dl>
        ) : null}

        {bandsApply ? (
          <FormField htmlFor="sim-amount" label={t('amount')} hint={t('amountHint')}>
            <Input
              id="sim-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="25000"
            />
          </FormField>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={!hasRules || !matrix || simulate.isPending}>
            {simulate.isPending ? t('running') : t('run')}
          </Button>
        </div>
      </form>

      {runError ? <Alert variant="error" messages={runError} /> : null}

      {result ? (
        <section aria-label={t('resultHeading')} className="space-y-4 border-t border-border pt-4">
          {result.ambiguous ? (
            <Alert variant="warning" title={t('ambiguousTitle')} messages={[t('ambiguousBody')]} />
          ) : null}

          <div>
            <h4 className="text-sm font-semibold text-foreground">{t('matchedHeading')}</h4>
            {result.matched ? (
              <>
                <p className="mt-1 text-caption text-muted-foreground">{t('matchedIntro')}</p>
                <TableScroll className="mt-3" aria-label={t('matchedHeading')}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-end">{t('colOrder')}</TableHead>
                        <TableHead>{t('colRule')}</TableHead>
                        <TableHead>{t('colRole')}</TableHead>
                        <TableHead className="text-end">{t('colPriority')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.roleChain.map((match, index) => (
                        <TableRow key={match.ruleId}>
                          <TableCell className="text-end tabular-nums text-muted-foreground">
                            {index + 1}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{match.ruleKey}</TableCell>
                          <TableCell className="text-sm">{match.requiredRole ?? '—'}</TableCell>
                          <TableCell className="text-end tabular-nums">{match.priority}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableScroll>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t('noMatch')}</p>
            )}
          </div>

          {result.rejectedRules.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-foreground">{t('rejectedHeading')}</h4>
              <p className="mt-1 text-caption text-muted-foreground">{t('rejectedIntro')}</p>
              <dl className="mt-3 divide-y divide-border rounded-panel border border-border">
                {result.rejectedRules.map((rejected) => (
                  <div
                    key={rejected.ruleId}
                    className="grid grid-cols-1 gap-1 px-3.5 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4"
                  >
                    <dt className="font-mono text-xs text-foreground">{rejected.ruleKey}</dt>
                    <dd>
                      <ul className="list-disc space-y-1 ps-4 text-sm text-muted-foreground">
                        {rejected.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <p className="text-caption text-muted-foreground">{t('notice')}</p>
        </section>
      ) : null}
    </div>
  );
}
