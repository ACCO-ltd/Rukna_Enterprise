'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  OverflowGlyph,
  RecordHeader,
  RecordLayout,
  RecordPanel,
  SkeletonRecord,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@erp/ui';

import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import type { ApprovalPolicySummary } from '../api/workflows-api';
import {
  useApprovalPolicy,
  useApprovalPolicySodRules,
  useValidateApprovalPolicyDraft,
} from '../hooks/use-approval-policies';
import { useWorkflowBindings } from '../hooks/use-workflow-bindings';
import { ClonePolicyDialog } from './clone-policy-dialog';
import { GovernanceLifecycleBar } from './governance-lifecycle-bar';
import { PolicyHistoryTimeline } from './policy-history-timeline';
import { PolicyLifecycleDialog, type LifecycleAction } from './policy-lifecycle-dialog';
import { PolicyOverviewTab } from './policy-overview-tab';
import { PolicyRulesTab } from './policy-rules-tab';
import { PolicySimulationPanel } from './policy-simulation-panel';
import { PolicySodEditor } from './policy-sod-editor';
import { PolicyVersionComparisonSheet } from './policy-version-comparison-sheet';

type WorkspaceTab = 'overview' | 'rules' | 'sod' | 'simulation' | 'history';

/**
 * Governance Builder workspace — the full-page detail surface that replaces the retired
 * 500-line `PolicyRuleBuilderSheet`. One workspace, one surface, tabs (not a wizard).
 *
 * The shell owns:
 *  - the record header (policy key · status badge · meta line · lifecycle dots-and-connector
 *    bar) and the per-status lifecycle actions, one primary each, permission-gated exactly as
 *    the sheet gated them: `manage:workflow` submits a DRAFT for review; `publish:workflow`
 *    schedules / activates / retires; `manage:workflow` clones;
 *  - the tab bar (Overview · Rules · Segregation of duties · Simulation · History) with counts,
 *    deep-linkable via `?tab=`. The Simulation tab is *absent* (not disabled) unless the policy
 *    is `editable` — the same rule the sheet's `ViewSwitcher` used;
 *  - the validation rail (sticky on desktop, above the tab body on mobile) carrying the quick
 *    stats and the Validate action, reachable from every tab.
 *
 * `editable` = DRAFT + `manage:workflow`, the spine of the whole lifecycle: it is the only
 * status that permits authoring rules / SoD and running the simulation.
 */
export function GovernanceWorkspace({ policyId }: { policyId: string }) {
  const t = useTranslations('platform.workflows.policies.workspace');
  const tBuilder = useTranslations('platform.workflows.policies.builder');
  const tPolicies = useTranslations('platform.workflows.policies');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = usePermissions();
  const canManage = can('manage:workflow');
  const canPublish = can('publish:workflow');

  const detail = useApprovalPolicy(policyId);
  const sod = useApprovalPolicySodRules(policyId);
  const bindings = useWorkflowBindings();
  const validate = useValidateApprovalPolicyDraft();

  const [action, setAction] = useState<LifecycleAction | null>(null);
  const [cloneTarget, setCloneTarget] = useState<ApprovalPolicySummary | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

  const breadcrumb = (
    <Breadcrumbs
      items={[
        { label: t('breadcrumbAdmin'), href: '/admin' },
        { label: t('breadcrumbPolicies'), href: '/admin/workflows' },
        { label: detail.data?.policyKey ?? '…' },
      ]}
    />
  );

  if (detail.isPending) {
    return (
      <div className="space-y-5">
        {breadcrumb}
        <SkeletonRecord label={t('loading')} />
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    // A deep-linked or stale policy id is now a real case — a 404 is "gone", not "broken".
    const notFound = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className="space-y-5">
        {breadcrumb}
        <Alert variant="error" messages={[notFound ? t('notFound') : t('loadFailed')]} />
        <Button variant="outline" onClick={() => router.push('/admin/workflows')}>
          {t('backToPolicies')}
        </Button>
      </div>
    );
  }

  const policy = detail.data;
  const isDraft = policy.status === 'DRAFT';
  const editable = isDraft && canManage;

  const ruleCount = policy.rules.length;
  const sodActiveCount = (sod.data ?? []).filter((rule) => rule.isActive).length;
  const sodCount = (sod.data ?? []).length;
  const policyTxTypes = new Set(
    policy.rules.map((rule) => rule.transactionType).filter(Boolean) as string[],
  );
  const boundTriggerCount = (bindings.data ?? []).filter(
    (binding) => binding.transactionType && policyTxTypes.has(binding.transactionType),
  ).length;

  // The active tab. Simulation is present only while the version is an editable draft — the
  // same conditional the retired ViewSwitcher used, so a non-draft simply has no Simulation tab.
  const tab = normalizeTab(searchParams.get('tab'), editable);
  function selectTab(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    const query = params.toString();
    router.replace(
      query ? `/admin/workflows/${policyId}?${query}` : `/admin/workflows/${policyId}`,
    );
  }

  // Lifecycle actions — one primary per status, permission-gated (unchanged logic, relocated
  // from the sheet to the header). Clone (and a draft's overflow) sit behind the ⋯ menu.
  const primaryAction =
    isDraft && canManage ? (
      <Button onClick={() => setAction('submit-review')}>{tBuilder('submitForReview')}</Button>
    ) : policy.status === 'IN_REVIEW' && canPublish ? (
      <Button onClick={() => setAction('schedule')}>{tBuilder('schedule')}</Button>
    ) : policy.status === 'SCHEDULED' && canPublish ? (
      <Button onClick={() => setAction('activate')}>{tBuilder('activate')}</Button>
    ) : policy.status === 'ACTIVE' && canPublish ? (
      <Button variant="outline" onClick={() => setAction('retire')}>
        {tBuilder('retire')}
      </Button>
    ) : null;

  const canClone = canManage;
  const actions = (
    <>
      {primaryAction}
      {canClone ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label={t('moreActions')}>
              <OverflowGlyph />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setCloneTarget(policy)}>
              {t('cloneAction')}
            </DropdownMenuItem>
            {policy.status === 'ACTIVE' ? (
              <DropdownMenuItem onSelect={() => setCompareOpen(true)}>
                {tPolicies('compareVersions')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );

  const header = (
    <RecordHeader
      breadcrumb={breadcrumb}
      title={<span className="font-mono">{policy.policyKey}</span>}
      subtitle={t('metaLine', {
        policyKey: policy.policyKey,
        version: policy.version,
        edited: formatDate(policy.updatedAt) ?? '—',
      })}
      status={
        <Badge tone={policy.status === 'ACTIVE' ? 'live' : 'neutral'}>{policy.status}</Badge>
      }
      actions={actions}
      lifecycle={<GovernanceLifecycleBar status={policy.status} />}
    />
  );

  const rail = (
    <RecordPanel title={t('validationTitle')}>
      <ValidationRail
        editable={editable}
        ruleCount={ruleCount}
        sodActiveCount={sodActiveCount}
        boundTriggerCount={boundTriggerCount}
        effectiveFrom={policy.effectiveFrom}
        validation={validate.data}
        isValidating={validate.isPending}
        onValidate={() => validate.mutate(policyId)}
      />
    </RecordPanel>
  );

  return (
    <RecordLayout header={header} rail={rail}>
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList>
          <TabsTrigger value="overview">{t('tabOverview')}</TabsTrigger>
          <TabsTrigger value="rules">
            {t('tabRules')} <Count value={ruleCount} />
          </TabsTrigger>
          <TabsTrigger value="sod">
            {t('tabSod')} <Count value={sodCount} />
          </TabsTrigger>
          {editable ? <TabsTrigger value="simulation">{t('tabSimulation')}</TabsTrigger> : null}
          <TabsTrigger value="history">{t('tabHistory')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <PolicyOverviewTab
            detail={policy}
            editable={editable}
            sodActiveCount={sodActiveCount}
            boundTriggerCount={boundTriggerCount}
            validation={validate.data}
            onCompareVersions={() => setCompareOpen(true)}
            onCloneVersion={(versionId) =>
              setCloneTarget(
                versionId === policy.id ? policy : ({ ...policy, id: versionId } as ApprovalPolicySummary),
              )
            }
          />
        </TabsContent>

        <TabsContent value="rules">
          <PolicyRulesTab policyId={policyId} rules={policy.rules} editable={editable} />
        </TabsContent>

        <TabsContent value="sod">
          <PolicySodEditor policyId={policyId} editable={editable} />
        </TabsContent>

        {editable ? (
          <TabsContent value="simulation">
            <PolicySimulationPanel policyId={policyId} hasRules={ruleCount > 0} />
          </TabsContent>
        ) : null}

        <TabsContent value="history">
          <PolicyHistoryTimeline policyId={policyId} />
        </TabsContent>
      </Tabs>

      {/* Lifecycle transition dialog — reason required, effective date when needed. */}
      <PolicyLifecycleDialog
        policyId={policyId}
        action={action}
        onOpenChange={(open) => !open && setAction(null)}
      />

      {/* Clone / rollback — on success, route to the new draft's workspace. */}
      <ClonePolicyDialog
        policy={cloneTarget}
        open={Boolean(cloneTarget)}
        onOpenChange={(open) => {
          if (!open) setCloneTarget(null);
        }}
        onCloned={(draft) => {
          setCloneTarget(null);
          router.push(`/admin/workflows/${draft.id}`);
        }}
      />

      {/* Version comparison — re-anchored to the workspace, still a side Sheet. */}
      <PolicyVersionComparisonSheet
        policyKey={compareOpen ? policy.policyKey : null}
        onOpenChange={(open) => {
          if (!open) setCompareOpen(false);
        }}
      />
    </RecordLayout>
  );
}

function Count({ value }: { value: number }) {
  return <span className="ms-1 text-caption tabular-nums text-muted-foreground">{value}</span>;
}

function normalizeTab(raw: string | null, editable: boolean): WorkspaceTab {
  if (raw === 'rules' || raw === 'sod' || raw === 'history') return raw;
  if (raw === 'simulation' && editable) return 'simulation';
  return 'overview';
}

/**
 * Validation rail — the quick stats + the Validate action + the pass/fail alert. On an
 * editable draft the Validate button is offered; on a published version the rail drops it and
 * shows read-only stats. Reachable from every tab because it lives in the layout rail.
 */
function ValidationRail({
  editable,
  ruleCount,
  sodActiveCount,
  boundTriggerCount,
  effectiveFrom,
  validation,
  isValidating,
  onValidate,
}: {
  editable: boolean;
  ruleCount: number;
  sodActiveCount: number;
  boundTriggerCount: number;
  effectiveFrom: string | null;
  validation: ReturnType<typeof useValidateApprovalPolicyDraft>['data'];
  isValidating: boolean;
  onValidate: () => void;
}) {
  const t = useTranslations('platform.workflows.policies.workspace');
  const tBuilder = useTranslations('platform.workflows.policies.builder');

  return (
    <div className="space-y-4">
      {validation ? (
        <Alert
          variant={validation.valid ? 'success' : 'error'}
          messages={
            validation.valid
              ? [t('validationPassed')]
              : validation.issues.map((issue) => issue.message)
          }
        />
      ) : (
        <p className="text-caption text-muted-foreground">
          {editable ? t('validationRun') : t('validationReadOnly')}
        </p>
      )}

      <dl className="space-y-0">
        <RailStat label={t('statRules')} value={ruleCount} />
        <RailStat label={t('statSod')} value={t('statSodActive', { count: sodActiveCount })} />
        <RailStat
          label={t('statEffective')}
          value={formatDate(effectiveFrom) ?? t('effectiveOnSchedule')}
        />
        <RailStat label={t('statBoundTriggers')} value={boundTriggerCount} />
      </dl>

      {editable ? (
        <Button variant="outline" className="w-full" onClick={onValidate} disabled={isValidating}>
          {tBuilder('validate')}
        </Button>
      ) : null}
    </div>
  );
}

function RailStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-end text-body-sm font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
