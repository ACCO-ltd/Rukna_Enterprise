'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  FormField,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  Textarea,
} from '@erp/ui';

import { usePermissions } from '@/features/auth/permissions/can';
import type { ApprovalPolicySummary } from '../api/workflows-api';
import { useApprovalPolicies, useCreateApprovalPolicyDraft } from '../hooks/use-approval-policies';
import { PolicyRuleBuilderSheet } from './policy-rule-builder-sheet';
import { ClonePolicyDialog } from './clone-policy-dialog';

export function ApprovalPolicyInventory() {
  const t = useTranslations('platform.workflows.policies');
  const { can } = usePermissions();
  const canManage = can('manage:workflow');

  const { data = [], isPending, isError } = useApprovalPolicies();
  const create = useCreateApprovalPolicyDraft();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ApprovalPolicySummary | null>(null);
  const [cloneTarget, setCloneTarget] = useState<ApprovalPolicySummary | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const policyKey = String(form.get('policyKey') ?? '').trim();
    const notes = String(form.get('notes') ?? '').trim();
    if (!policyKey) return;
    create.mutate({ policyKey, ...(notes ? { notes } : {}) }, { onSuccess: () => setOpen(false) });
  }

  return (
    <section aria-labelledby="approval-policies-heading" className="space-y-4">
      <div>
        <h2 id="approval-policies-heading" className="text-base font-semibold text-foreground">
          {t('heading')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('subheading')}</p>
      </div>

      {canManage ? <Button onClick={() => setOpen(true)}>{t('newDraft')}</Button> : null}

      {isPending ? (
        <div className="h-32 animate-pulse rounded-panel border border-border bg-muted" />
      ) : isError ? (
        <Alert variant="error" messages={[t('loadFailed')]} />
      ) : data.length === 0 ? (
        <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <TableScroll aria-label={t('heading')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colPolicy')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead className="text-end">{t('colVersion')}</TableHead>
                <TableHead className="text-end">{t('colRules')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((policy) => (
                <TableRow
                  key={policy.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(policy)}
                >
                  <TableCell>
                    <div className="font-medium">{policy.policyKey}</div>
                    <div className="text-xs text-muted-foreground">{policy.amountBasis}</div>
                  </TableCell>
                  <TableCell>
                    <Badge tone={policy.status === 'ACTIVE' ? 'live' : 'neutral'}>{policy.status}</Badge>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">v{policy.version}</TableCell>
                  <TableCell className="text-end tabular-nums">{policy.ruleCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}

      <PolicyRuleBuilderSheet
        policy={selected}
        onOpenChange={(value) => {
          if (!value) setSelected(null);
        }}
        onRequestClone={(policy) => setCloneTarget(policy)}
      />

      <ClonePolicyDialog
        policy={cloneTarget}
        open={Boolean(cloneTarget)}
        onOpenChange={(value) => {
          if (!value) setCloneTarget(null);
        }}
        onCloned={(draft) => {
          setCloneTarget(null);
          setSelected(draft);
        }}
      />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="p-6">
          <SheetTitle>{t('newDraft')}</SheetTitle>
          <SheetDescription className="mt-1">{t('draftHint')}</SheetDescription>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <FormField htmlFor="policyKey" label={t('policyKey')} required>
              <Input
                id="policyKey"
                name="policyKey"
                required
                pattern="[A-Z][A-Z0-9_]{2,79}"
                placeholder="PURCHASE_ORDER_APPROVAL"
                disabled={create.isPending}
              />
            </FormField>
            <FormField htmlFor="notes" label={t('notes')}>
              <Textarea id="notes" name="notes" rows={3} disabled={create.isPending} />
            </FormField>
            {create.error ? <Alert variant="error" messages={[t('createFailed')]} /> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? t('creating') : t('create')}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </section>
  );
}
