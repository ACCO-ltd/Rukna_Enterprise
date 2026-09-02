'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Select,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@erp/ui';

import type { ApprovalPolicyVersionSummary } from '@erp/types';

import {
  useApprovalPolicyComparison,
  useApprovalPolicyVersions,
} from '../hooks/use-approval-policies';
import { PolicyComparisonDiff } from './policy-comparison-diff';

/**
 * Version history + comparison for one policyKey (ADR-027 GOV-ADM-005).
 *
 * Opened from the inventory. Lists every version of the key (newest first) and lets the
 * administrator pick two to compare; the diff renders read-only via `PolicyComparisonDiff`.
 * This is a read surface — gating is the caller's job (`view:workflow`); nothing here writes.
 *
 * States covered: loading (skeleton), load error, and the single-version case, which has no
 * earlier version to compare against and says so rather than showing an inert picker.
 */
export function PolicyVersionComparisonSheet({
  policyKey,
  onOpenChange,
}: {
  policyKey: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('platform.workflows.policies.compare');
  const history = useApprovalPolicyVersions(policyKey);
  const versions = history.data?.versions ?? [];

  return (
    <Sheet open={Boolean(policyKey)} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto p-6">
        <SheetTitle>
          {t('title')}{' '}
          <span className="font-mono text-sm font-normal text-muted-foreground">{policyKey}</span>
        </SheetTitle>
        <SheetDescription>{t('description')}</SheetDescription>

        {history.isPending ? (
          <div
            className="mt-5 h-40 animate-pulse rounded-panel border border-border bg-muted"
            aria-hidden="true"
          />
        ) : history.isError ? (
          <Alert className="mt-5" variant="error" messages={[t('historyLoadFailed')]} />
        ) : versions.length === 0 ? (
          <p className="mt-5 rounded-panel border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
            {t('noVersions')}
          </p>
        ) : (
          <VersionComparer versions={versions} />
        )}
      </SheetContent>
    </Sheet>
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
    <div className="mt-5 space-y-5">
      {/* Version roster — a compact read of the lifecycle across versions. */}
      <ul className="space-y-1.5">
        {versions.map((version) => (
          <li key={version.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-foreground">v{version.version}</span>
            <Badge tone={version.status === 'ACTIVE' ? 'live' : 'neutral'}>{version.status}</Badge>
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
