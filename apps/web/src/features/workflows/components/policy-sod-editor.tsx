'use client';

import { type FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  FormField,
  Input,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import {
  useApprovalPolicySodRules,
  useUpsertApprovalPolicySodRule,
} from '../hooks/use-approval-policies';
import type { PolicySodRule } from '../api/workflows-api';

/**
 * Segregation-of-duties editor for a DRAFT policy.
 *
 * Consumes `useApprovalPolicySodRules` → `GET /workflows/policies/:id/sod-rules` (read) and
 * `useUpsertApprovalPolicySodRule` → `POST /workflows/policies/:id/sod-rules` (add / toggle).
 *
 * The upsert keys on `code`, so re-submitting an existing code with a flipped `isActive` is how
 * a rule is toggled — the same endpoint serves both add and toggle. Only rendered on a draft;
 * the server rejects the write against any other status.
 */
export function PolicySodEditor({ policyId, editable }: { policyId: string; editable: boolean }) {
  const t = useTranslations('platform.workflows.policies.sod');
  const rules = useApprovalPolicySodRules(policyId);
  const upsert = useUpsertApprovalPolicySodRule();

  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');

  function addRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code.trim() || !description.trim()) return;
    upsert.mutate(
      { id: policyId, code: code.trim().toUpperCase(), description: description.trim(), isActive: true },
      {
        onSuccess: () => {
          setCode('');
          setDescription('');
        },
      },
    );
  }

  function toggle(rule: PolicySodRule) {
    upsert.mutate({
      id: policyId,
      code: rule.code,
      description: rule.description,
      isActive: !rule.isActive,
    });
  }

  const upsertError =
    upsert.error instanceof ApiError && upsert.error.messages.length > 0
      ? upsert.error.messages
      : upsert.isError
        ? [t('failed')]
        : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      {editable ? (
        <form onSubmit={addRule} className="space-y-3 rounded-panel border border-border bg-surface-subtle p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
            <FormField htmlFor="sod-code" label={t('code')} required>
              <Input
                id="sod-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                className="uppercase"
                placeholder="PO_NOT_SELF_APPROVE"
                maxLength={80}
              />
            </FormField>
            <FormField htmlFor="sod-desc" label={t('description')} required>
              <Input
                id="sod-desc"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('descriptionPlaceholder')}
                maxLength={240}
              />
            </FormField>
          </div>
          {upsertError ? <Alert variant="error" messages={upsertError} /> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={upsert.isPending || !code.trim() || !description.trim()}>
              {upsert.isPending ? t('adding') : t('add')}
            </Button>
          </div>
        </form>
      ) : null}

      {rules.isPending ? (
        <div className="h-24 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
      ) : rules.isError ? (
        <Alert variant="error" messages={[t('loadFailed')]} />
      ) : (
        <TableScroll aria-label={t('heading')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('code')}</TableHead>
                <TableHead>{t('description')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                {editable ? <TableHead className="text-end">{t('actions')}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rules.data ?? []).length === 0 ? (
                <TableEmpty colSpan={editable ? 4 : 3}>{t('empty')}</TableEmpty>
              ) : (
                (rules.data ?? []).map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-mono text-xs">{rule.code}</TableCell>
                    <TableCell className="text-sm text-foreground">{rule.description}</TableCell>
                    <TableCell>
                      <Badge tone={rule.isActive ? 'live' : 'neutral'}>
                        {rule.isActive ? t('active') : t('inactive')}
                      </Badge>
                    </TableCell>
                    {editable ? (
                      <TableCell className="text-end">
                        <Button
                          variant="ghost"
                          disabled={upsert.isPending}
                          onClick={() => toggle(rule)}
                        >
                          {rule.isActive ? t('deactivate') : t('activate')}
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableScroll>
      )}
    </div>
  );
}
