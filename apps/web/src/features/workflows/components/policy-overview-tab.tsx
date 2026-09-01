'use client';

import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  DefinitionList,
  DefinitionRow,
  SectionHeader,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { formatDate } from '@/lib/format';
import type {
  ApprovalPolicyDetail,
  DraftValidation,
} from '../api/workflows-api';
import { useApprovalPolicyVersions } from '../hooks/use-approval-policies';
import { useWorkflowBindings } from '../hooks/use-workflow-bindings';
import type { WorkflowTriggerBinding } from '../types';

/**
 * Overview tab — the "what is this policy, where is it in its life, is it ready" read the
 * builder sheet never had. Details (`DefinitionList`), a divider-separated metric strip (no
 * KPI cards), a read-only linked-bindings mini-table, and the version roster promoted onto the
 * workspace, from which Compare and Clone-to-new-draft are launched.
 *
 * Bindings and versions are their own reads; the tab degrades honestly (loading / error /
 * empty) for each rather than blocking the whole page on one. The authoring progress cue is a
 * one-line hint derived from state — it links to tabs, it never gates them.
 */
export function PolicyOverviewTab({
  detail,
  editable,
  sodActiveCount,
  boundTriggerCount,
  validation,
  onCompareVersions,
  onCloneVersion,
}: {
  detail: ApprovalPolicyDetail;
  editable: boolean;
  sodActiveCount: number;
  boundTriggerCount: number;
  validation: DraftValidation | undefined;
  /** Opens the version-comparison overlay for this policy key. */
  onCompareVersions: () => void;
  /** Opens the clone-to-new-draft dialog for a specific version id. */
  onCloneVersion: (versionId: string) => void;
}) {
  const t = useTranslations('platform.workflows.policies.workspace');

  const ruleCount = detail.rules.length;
  const validationState: 'valid' | 'issues' | 'unknown' = validation
    ? validation.valid
      ? 'valid'
      : 'issues'
    : 'unknown';

  const progressHint = editable
    ? ruleCount === 0
      ? t('progressStartRules')
      : sodActiveCount === 0
        ? t('progressAddSod')
        : t('progressValidate')
    : null;

  return (
    <div className="space-y-8">
      {/* Policy details */}
      <section aria-labelledby="overview-details-heading" className="space-y-3">
        <SectionHeader id="overview-details-heading" title={t('overviewDetailsHeading')} />
        <DefinitionList>
          <DefinitionRow label={t('detailPolicyKey')}>
            <span className="font-mono">{detail.policyKey}</span>
          </DefinitionRow>
          <DefinitionRow label={t('detailVersion')} numeric>
            v{detail.version}
          </DefinitionRow>
          <DefinitionRow label={t('detailStatus')}>
            <Badge tone={detail.status === 'ACTIVE' ? 'live' : 'neutral'}>{detail.status}</Badge>
          </DefinitionRow>
          <DefinitionRow label={t('detailAmountBasis')}>{detail.amountBasis}</DefinitionRow>
          <DefinitionRow
            label={t('detailEffectiveFrom')}
            emptyText={detail.status === 'DRAFT' ? t('effectiveOnSchedule') : '—'}
          >
            {formatDate(detail.effectiveFrom) ?? undefined}
          </DefinitionRow>
          <DefinitionRow label={t('detailEffectiveTo')}>
            {formatDate(detail.effectiveTo) ?? undefined}
          </DefinitionRow>
          <DefinitionRow label={t('detailUpdated')}>
            {formatDate(detail.updatedAt) ?? undefined}
          </DefinitionRow>
          <DefinitionRow label={t('detailNotes')}>{detail.notes ?? undefined}</DefinitionRow>
        </DefinitionList>
        {progressHint ? (
          <p className="text-caption text-muted-foreground">
            <span className="font-medium text-foreground">{t('progressHint')}</span> {progressHint}
          </p>
        ) : null}
      </section>

      {/* Quick stats — a divider-separated metric strip, mirroring the rail. */}
      <section aria-labelledby="overview-stats-heading" className="space-y-3">
        <SectionHeader id="overview-stats-heading" title={t('quickStatsHeading')} />
        <dl className="flex flex-wrap divide-x divide-border border-y border-border">
          <Metric label={t('statRules')} value={<span className="tabular-nums">{ruleCount}</span>} />
          <Metric
            label={t('statSod')}
            value={<span className="tabular-nums">{t('statSodActive', { count: sodActiveCount })}</span>}
          />
          <Metric
            label={t('statValidation')}
            value={<ValidationWord state={validationState} count={validation?.issues.length ?? 0} />}
          />
          <Metric
            label={t('statBoundTriggers')}
            value={<span className="tabular-nums">{boundTriggerCount}</span>}
          />
        </dl>
      </section>

      {/* Linked bindings — read-only, filtered to this policy's transitions. */}
      <LinkedBindings detail={detail} />

      {/* Versions — the roster promoted onto Overview. */}
      <PolicyVersions
        detail={detail}
        onCompareVersions={onCompareVersions}
        onCloneVersion={onCloneVersion}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-[7rem] flex-1 px-4 py-3">
      <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function ValidationWord({ state, count }: { state: 'valid' | 'issues' | 'unknown'; count: number }) {
  const t = useTranslations('platform.workflows.policies.workspace');
  if (state === 'valid') {
    return (
      <span className="inline-flex items-center gap-1.5 text-success">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
        {t('validationPassed')}
      </span>
    );
  }
  if (state === 'issues') {
    return (
      <span className="inline-flex items-center gap-1.5 text-danger">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-danger" />
        {t('validationIssues', { count })}
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

/**
 * The subset of governance bindings whose transaction type matches a rule on this policy —
 * the honest "what actually gates this transition". Read-only, with the by-design no-toggle
 * note carried from the bindings panel.
 */
function LinkedBindings({ detail }: { detail: ApprovalPolicyDetail }) {
  const t = useTranslations('platform.workflows.policies.workspace');
  const bindings = useWorkflowBindings();

  const policyTxTypes = new Set(
    detail.rules.map((rule) => rule.transactionType).filter(Boolean) as string[],
  );
  const linked = (bindings.data ?? []).filter(
    (binding) => binding.transactionType && policyTxTypes.has(binding.transactionType),
  );

  return (
    <section aria-labelledby="overview-bindings-heading" className="space-y-3">
      <SectionHeader id="overview-bindings-heading" title={t('linkedBindingsHeading')} />
      {bindings.isPending ? (
        <div
          className="h-20 animate-pulse rounded-panel border border-border bg-muted"
          aria-hidden="true"
        />
      ) : bindings.isError ? (
        <Alert variant="error" messages={[t('linkedBindingsLoadFailed')]} />
      ) : linked.length === 0 ? (
        <p className="rounded-panel border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
          {t('linkedBindingsEmpty')}
        </p>
      ) : (
        <TableScroll aria-label={t('linkedBindingsHeading')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('bindingColTransition')}</TableHead>
                <TableHead>{t('bindingColChain')}</TableHead>
                <TableHead>{t('bindingColStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linked.map((binding) => (
                <BindingRow key={binding.id} binding={binding} />
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}
      <p className="text-caption text-muted-foreground">{t('linkedBindingsNote')}</p>
    </section>
  );
}

function BindingRow({ binding }: { binding: WorkflowTriggerBinding }) {
  const t = useTranslations('platform.workflows.policies.workspace');
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium text-foreground">{binding.entityType}</div>
        <div className="mt-0.5 font-mono text-xs text-muted-foreground">
          {binding.fromState && binding.toState
            ? `${binding.fromState} → ${binding.toState}`
            : '—'}
        </div>
      </TableCell>
      <TableCell className="text-sm text-foreground">{binding.definition.name}</TableCell>
      <TableCell>
        <Badge tone={binding.isActive ? 'live' : 'neutral'}>
          {binding.isActive ? t('bindingActive') : t('bindingInactive')}
        </Badge>
      </TableCell>
    </TableRow>
  );
}

/** The version roster, promoted from the comparison sheet onto Overview. */
function PolicyVersions({
  detail,
  onCompareVersions,
  onCloneVersion,
}: {
  detail: ApprovalPolicyDetail;
  onCompareVersions: () => void;
  onCloneVersion: (versionId: string) => void;
}) {
  const t = useTranslations('platform.workflows.policies.workspace');
  const tPolicies = useTranslations('platform.workflows.policies');
  const history = useApprovalPolicyVersions(detail.policyKey);
  const versions = history.data?.versions ?? [];

  return (
    <section aria-labelledby="overview-versions-heading" className="space-y-3">
      <SectionHeader id="overview-versions-heading" title={t('versionsHeading')}>
        {versions.length >= 2 ? (
          <Button variant="outline" size="sm" onClick={onCompareVersions}>
            {t('versionCompare')}
          </Button>
        ) : null}
      </SectionHeader>

      {history.isPending ? (
        <div
          className="h-20 animate-pulse rounded-panel border border-border bg-muted"
          aria-hidden="true"
        />
      ) : history.isError ? (
        <Alert variant="error" messages={[t('versionsLoadFailed')]} />
      ) : (
        <TableScroll aria-label={t('versionsHeading')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('detailVersion')}</TableHead>
                <TableHead>{t('detailStatus')}</TableHead>
                <TableHead className="text-end">{t('statRules')}</TableHead>
                <TableHead className="text-end">{tPolicies('colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.length === 0 ? (
                <TableEmpty colSpan={4}>{t('versionsEmpty')}</TableEmpty>
              ) : (
                versions.map((version) => {
                  const isCurrent = version.id === detail.id;
                  return (
                    <TableRow key={version.id}>
                      <TableCell className="font-mono text-xs">v{version.version}</TableCell>
                      <TableCell>
                        <Badge tone={version.status === 'ACTIVE' ? 'live' : 'neutral'}>
                          {version.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{version.ruleCount}</TableCell>
                      <TableCell className="text-end">
                        {isCurrent ? (
                          <span className="text-caption text-muted-foreground">
                            {t('versionHere')}
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onCloneVersion(version.id)}
                          >
                            {t('versionClone')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableScroll>
      )}
    </section>
  );
}
