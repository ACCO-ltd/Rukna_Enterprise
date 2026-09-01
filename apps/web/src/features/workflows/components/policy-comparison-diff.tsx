'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@erp/ui';

import type {
  ApprovalPolicyComparison,
  ApprovalPolicyRuleSnapshot,
  ApprovalPolicySodDiff,
} from '@erp/types';

import { policyMatrixFor } from '../policy-matrix';

/**
 * The read-only rule- and SoD-level diff between two policy versions.
 *
 * Shared by the version-comparison view and the rollback preview — both consume the same
 * `ApprovalPolicyComparison` shape, so the presentation lives here once. Colour is carried by the
 * status tokens only (added = `live`/success, removed = `danger`, changed = `warning`), never a raw
 * hex, and every band pairs a word with the colour per the doctrine's status rule.
 *
 * At 375px the diff stacks: each rule is its own bordered row with fields wrapping under it, so the
 * component scrolls vertically inside its container and never forces the page to scroll sideways.
 */

const RULE_FIELD_ORDER: (keyof Omit<ApprovalPolicyRuleSnapshot, 'ruleKey'>)[] = [
  'transactionType',
  'priority',
  'requiredRole',
  'minAmount',
  'maxAmount',
  'fromState',
  'toState',
];

function displayValue(value: string | number | null): string {
  if (value === null || value === '') return '—';
  return String(value);
}

export function PolicyComparisonDiff({ comparison }: { comparison: ApprovalPolicyComparison }) {
  const t = useTranslations('platform.workflows.policies.compare');
  const { added, removed, changed } = comparison.rules;
  const sodRules = comparison.sodRules;

  const fieldLabel = (field: keyof Omit<ApprovalPolicyRuleSnapshot, 'ruleKey'>): string =>
    t(`field.${field}`);

  const identical =
    added.length === 0 && removed.length === 0 && changed.length === 0 && sodRules.length === 0;

  if (identical) {
    return (
      <p className="rounded-panel border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
        {t('identical')}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary line — plain counts, neutral, so the bands below carry the colour. */}
      <p className="text-sm text-muted-foreground">
        {t('summary', {
          added: added.length,
          removed: removed.length,
          changed: changed.length,
          sod: sodRules.length,
        })}
      </p>

      {added.length > 0 ? (
        <DiffGroup title={t('addedHeading')} count={added.length} tone="live">
          {added.map((rule) => (
            <RuleCard key={rule.ruleKey} rule={rule} tone="live" fieldLabel={fieldLabel} />
          ))}
        </DiffGroup>
      ) : null}

      {removed.length > 0 ? (
        <DiffGroup title={t('removedHeading')} count={removed.length} tone="danger">
          {removed.map((rule) => (
            <RuleCard key={rule.ruleKey} rule={rule} tone="danger" fieldLabel={fieldLabel} />
          ))}
        </DiffGroup>
      ) : null}

      {changed.length > 0 ? (
        <DiffGroup title={t('changedHeading')} count={changed.length} tone="warning">
          {changed.map((rule) => (
            <div key={rule.ruleKey} className="rounded-panel border border-warning/20 bg-warning-subtle/40 p-3">
              <p className="font-mono text-xs text-foreground">{rule.ruleKey}</p>
              <dl className="mt-2 space-y-1.5">
                {rule.changes.map((change) => (
                  <div key={change.field} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                    <dt className="text-caption text-muted-foreground">{fieldLabel(change.field)}</dt>
                    <dd className="flex flex-wrap items-baseline gap-1.5">
                      <span className="text-muted-foreground line-through">{displayValue(change.base)}</span>
                      <span aria-hidden="true" className="text-muted-foreground">→</span>
                      <span className="font-medium text-foreground">{displayValue(change.target)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </DiffGroup>
      ) : null}

      {sodRules.length > 0 ? (
        <DiffGroup title={t('sodHeading')} count={sodRules.length} tone="accent">
          {sodRules.map((diff) => (
            <SodCard key={diff.code} diff={diff} />
          ))}
        </DiffGroup>
      ) : null}
    </div>
  );
}

function DiffGroup({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: 'live' | 'danger' | 'warning' | 'accent';
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex items-center gap-2 border-b border-border pb-1.5">
        <h4 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
        <Badge tone={tone}>{count}</Badge>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function RuleCard({
  rule,
  tone,
  fieldLabel,
}: {
  rule: ApprovalPolicyRuleSnapshot;
  tone: 'live' | 'danger';
  fieldLabel: (field: keyof Omit<ApprovalPolicyRuleSnapshot, 'ruleKey'>) => string;
}) {
  const wrap =
    tone === 'live'
      ? 'border-success/20 bg-success-subtle/40'
      : 'border-danger/20 bg-danger-subtle/40';
  const matrix = policyMatrixFor(rule.transactionType);

  return (
    <div className={`rounded-panel border p-3 ${wrap}`}>
      <p className="font-mono text-xs text-foreground">{rule.ruleKey}</p>
      {matrix ? <p className="mt-0.5 text-caption text-muted-foreground">{matrix.label}</p> : null}
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {RULE_FIELD_ORDER.map((field) => {
          const value = rule[field];
          if (value === null || value === '') return null;
          return (
            <div key={field} className="flex items-baseline gap-2 text-sm">
              <dt className="text-caption text-muted-foreground">{fieldLabel(field)}</dt>
              <dd className="text-foreground">{String(value)}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function SodCard({ diff }: { diff: ApprovalPolicySodDiff }) {
  const t = useTranslations('platform.workflows.policies.compare');
  // A code present only on base was removed; only on target was added; on both is a description or
  // active-flag change. The tone is chosen so the word + colour agree with the rule bands above.
  const kind: 'added' | 'removed' | 'changed' =
    diff.base === null ? 'added' : diff.target === null ? 'removed' : 'changed';
  const tone = kind === 'added' ? 'live' : kind === 'removed' ? 'danger' : 'warning';
  const wrap =
    kind === 'added'
      ? 'border-success/20 bg-success-subtle/40'
      : kind === 'removed'
        ? 'border-danger/20 bg-danger-subtle/40'
        : 'border-warning/20 bg-warning-subtle/40';

  return (
    <div className={`rounded-panel border p-3 ${wrap}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-foreground">{diff.code}</span>
        <Badge tone={tone}>{t(`sodKind.${kind}`)}</Badge>
      </div>
      <dl className="mt-2 space-y-1 text-sm">
        <SodRow label={t('sodDescription')} base={diff.base?.description ?? null} target={diff.target?.description ?? null} kind={kind} />
        <SodRow
          label={t('sodActive')}
          base={diff.base ? t(diff.base.isActive ? 'yes' : 'no') : null}
          target={diff.target ? t(diff.target.isActive ? 'yes' : 'no') : null}
          kind={kind}
        />
      </dl>
    </div>
  );
}

function SodRow({
  label,
  base,
  target,
  kind,
}: {
  label: string;
  base: string | null;
  target: string | null;
  kind: 'added' | 'removed' | 'changed';
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-1.5">
        {kind === 'added' ? (
          <span className="font-medium text-foreground">{base ?? target ?? '—'}</span>
        ) : kind === 'removed' ? (
          <span className="text-muted-foreground line-through">{base ?? '—'}</span>
        ) : (
          <>
            <span className="text-muted-foreground line-through">{base ?? '—'}</span>
            <span aria-hidden="true" className="text-muted-foreground">→</span>
            <span className="font-medium text-foreground">{target ?? '—'}</span>
          </>
        )}
      </dd>
    </div>
  );
}
