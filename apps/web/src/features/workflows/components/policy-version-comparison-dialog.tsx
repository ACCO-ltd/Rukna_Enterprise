'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  Select,
  StatusPill,
} from '@erp/ui';

import { statusTone } from '@/lib/status-registry';

import type { ApprovalPolicyVersionSummary } from '@erp/types';

import {
  useApprovalPolicyComparison,
  useApprovalPolicyVersions,
} from '../hooks/use-approval-policies';
import { PolicyComparisonDiff } from './policy-comparison-diff';

/**
 * Version history + comparison for one policyKey (ADR-027 GOV-ADM-005).
 *
 * A read-only `FormDialog` at `2xl` (ADR-039: comparisons), with Close as its only action.
 * Opened from the inventory. Lists every version of the key (newest first) and lets the
 * administrator pick two to compare; the diff renders read-only via `PolicyComparisonDiff`.
 * This is a read surface — gating is the caller's job (`view:workflow`); nothing here writes.
 *
 * States covered: loading (skeleton), load error, and the single-version case, which has no
 * earlier version to compare against and says so rather than showing an inert picker.
 */
export function PolicyVersionComparisonDialog({
  policyKey,
  onOpenChange,
}: {
  policyKey: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('platform.workflows.policies.compare');
  const tc = useTranslations('common');
  const history = useApprovalPolicyVersions(policyKey);
  const versions = history.data?.versions ?? [];

  return (
    <FormDialog
      open={Boolean(policyKey)}
      onOpenChange={onOpenChange}
      size="2xl"
      // A comparison is read, not filled in: focus the dialog, not the first version picker.
      initialFocus="dialog"
      closeLabel={tc('close')}
      title={
        <>
          {t('title')}{' '}
          <span className="font-mono text-sm font-normal text-muted-foreground">{policyKey}</span>
        </>
      }
      subtitle={t('description')}
    >
      <FormDialogBody>
        {history.isPending ? (
          <div
            className="h-40 animate-pulse rounded-panel border border-border bg-muted"
            aria-hidden="true"
          />
        ) : history.isError ? (
          <Alert variant="error" messages={[t('historyLoadFailed')]} />
        ) : versions.length === 0 ? (
          <p className="rounded-panel border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
            {t('noVersions')}
          </p>
        ) : (
          <VersionComparer versions={versions} />
        )}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline">
            {tc('close')}
          </Button>
        </FormDialogClose>
      </FormDialogFooter>
    </FormDialog>
  );
}

function VersionComparer({ versions }: { versions: ApprovalPolicyVersionSummary[] }) {
  const t = useTranslations('platform.workflows.policies.compare');

  // Default base = the second-newest, target = the newest, so opening lands on the most recent
  // change. With a single version there is nothing to compare (handled below).
  const newest = versions[0];
  const previous = versions[1];
  const [baseId, setBaseId] = useState<string>(previous?.id ?? '');
  const [targetId, setTargetId] = useState<string>(newest?.id ?? '');

  const singleVersion = versions.length < 2;
  const sameVersion = baseId !== '' && baseId === targetId;

  const comparison = useApprovalPolicyComparison(
    singleVersion ? null : baseId || null,
    singleVersion ? null : targetId || null,
  );

  return (
    <div className="space-y-5">
      {/* Version roster — a compact read of the lifecycle across versions. */}
      <ul className="space-y-1.5">
        {versions.map((version) => (
          <li key={version.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-foreground">v{version.version}</span>
            <StatusPill tone={statusTone(version.status, 'approvalPolicy')}>{version.status}</StatusPill>
            <span className="text-caption text-muted-foreground">
              {t('ruleCount', { count: version.ruleCount })}
            </span>
          </li>
        ))}
      </ul>

      {singleVersion ? (
        <p className="rounded-panel border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
          {t('singleVersion')}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                {t('baseLabel')}
              </span>
              <Select value={baseId} onChange={(value) => setBaseId(value)} aria-label={t('baseLabel')}>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {t('versionOption', { version: version.version, status: version.status })}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                {t('targetLabel')}
              </span>
              <Select value={targetId} onChange={(value) => setTargetId(value)} aria-label={t('targetLabel')}>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {t('versionOption', { version: version.version, status: version.status })}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          {sameVersion ? (
            <p className="rounded-panel border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
              {t('sameVersion')}
            </p>
          ) : comparison.isPending ? (
            <div
              className="h-32 animate-pulse rounded-panel border border-border bg-muted"
              aria-hidden="true"
            />
          ) : comparison.isError ? (
            <Alert variant="error" messages={[t('compareLoadFailed')]} />
          ) : comparison.data ? (
            <PolicyComparisonDiff comparison={comparison.data} />
          ) : null}
        </>
      )}
    </div>
  );
}
