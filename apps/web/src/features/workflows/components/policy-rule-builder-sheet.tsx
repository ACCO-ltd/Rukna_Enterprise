'use client';

import { type FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
  Select,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  ViewSwitcher,
} from '@erp/ui';

import { useRoles } from '@/features/roles/hooks/use-roles';
import { usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';
import type { ApprovalPolicyDetail, ApprovalPolicySummary } from '../api/workflows-api';
import {
  useApprovalPolicy,
  useDeleteApprovalPolicyRule,
  useReorderApprovalPolicyRules,
  useTransitionApprovalPolicy,
  useUpdateApprovalPolicyRule,
  useValidateApprovalPolicyDraft,
} from '../hooks/use-approval-policies';
import { policyMatrixFor } from '../policy-matrix';
import { PolicyAddRuleForm } from './policy-add-rule-form';
import { PolicySodEditor } from './policy-sod-editor';
import { PolicyHistoryTimeline } from './policy-history-timeline';

type LifecycleAction = 'submit-review' | 'schedule' | 'activate' | 'retire';

const LIFECYCLE_COPY: Record<
  LifecycleAction,
  { title: string; description: string; button: string; needsDate: boolean }
> = {
  'submit-review': {
    title: 'Submit policy for review',
    description: 'The draft becomes read-only and must pass validation.',
    button: 'Submit for review',
    needsDate: false,
  },
  schedule: {
    title: 'Schedule policy',
    description: 'A second administrator is required — the submitter cannot schedule their own draft. Select a future effective date.',
    button: 'Schedule policy',
    needsDate: true,
  },
  activate: {
    title: 'Activate policy',
    description: 'Confirm the policy is due and ready to govern transactions.',
    button: 'Activate policy',
    needsDate: true,
  },
  retire: {
    title: 'Retire policy',
    description: 'This policy will stop applying to new evaluations.',
    button: 'Retire policy',
    needsDate: false,
  },
};

type PolicyView = 'rules' | 'sod' | 'history';

/**
 * The policy authoring workspace opened from the inventory.
 *
 * Three level-3 views (rules · segregation of duties · history) switch in place via
 * `ViewSwitcher`, so the sheet never stacks a second tab bar (ux-doctrine §5). Write
 * affordances are gated: `manage:workflow` authors rules / SoD and submits for review;
 * `publish:workflow` schedules, activates, and retires. A viewer without either sees the
 * version read-only.
 *
 * Draft rules are editable only while `status === 'DRAFT'`; the edit dialog pins the
 * transition to the approved matrix pair for the rule's transaction type rather than
 * free-texting it, matching what the server will accept.
 */
export function PolicyRuleBuilderSheet({
  policy,
  onOpenChange,
  onRequestClone,
}: {
  policy: ApprovalPolicySummary | null;
  onOpenChange: (open: boolean) => void;
  onRequestClone?: (policy: ApprovalPolicySummary) => void;
}) {
  const t = useTranslations('platform.workflows.policies.builder');
  const { can } = usePermissions();
  const canManage = can('manage:workflow');
  const canPublish = can('publish:workflow');

  const detail = useApprovalPolicy(policy?.id ?? null);
  const roles = useRoles();
  const update = useUpdateApprovalPolicyRule();
  const remove = useDeleteApprovalPolicyRule();
  const reorder = useReorderApprovalPolicyRules();
  const validate = useValidateApprovalPolicyDraft();
  const transition = useTransitionApprovalPolicy();

  const [view, setView] = useState<PolicyView>('rules');
  const [editing, setEditing] = useState<ApprovalPolicyDetail['rules'][number] | null>(null);
  const [action, setAction] = useState<LifecycleAction | null>(null);
  const [reason, setReason] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');

  // Reset the local view to Rules when a different policy opens, without an effect: the
  // render-phase "reset state on prop change" pattern React recommends over a setState effect.
  const [viewOwnerId, setViewOwnerId] = useState<string | null>(policy?.id ?? null);
  if ((policy?.id ?? null) !== viewOwnerId) {
    setViewOwnerId(policy?.id ?? null);
    setView('rules');
  }

  const isDraft = policy?.status === 'DRAFT';
  const editable = isDraft && canManage;

  function move(id: string, offset: -1 | 1) {
    if (!policy || !detail.data) return;
    const ids = detail.data.rules.map((rule) => rule.id);
    const i = ids.indexOf(id);
    if (i + offset < 0 || i + offset >= ids.length) return;
    [ids[i], ids[i + offset]] = [ids[i + offset], ids[i]];
    reorder.mutate({ id: policy.id, ruleIds: ids });
  }

  function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy || !editing) return;
    const matrix = policyMatrixFor(editing.transactionType);
    const form = new FormData(event.currentTarget);
    update.mutate(
      {
        policyId: policy.id,
        ruleId: editing.id,
        ruleKey: editing.ruleKey,
        transactionType: editing.transactionType ?? '',
        requiredRole: String(form.get('requiredRole')),
        priority: Number(form.get('priority')),
        minAmount: String(form.get('minAmount') || '') || undefined,
        maxAmount: String(form.get('maxAmount') || '') || undefined,
        // Transition is pinned to the approved matrix pair, not free-text.
        fromState: matrix?.fromState,
        toState: matrix?.toState,
      },
      { onSuccess: () => setEditing(null) },
    );
  }

  function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy || !action) return;
    transition.mutate(
      { id: policy.id, action, reason, effectiveFrom: effectiveFrom || undefined },
      {
        onSuccess: () => {
          setAction(null);
          setReason('');
          setEffectiveFrom('');
        },
      },
    );
  }

  const editingMatrix = policyMatrixFor(editing?.transactionType);
  const canCloneThis = canManage && Boolean(policy) && Boolean(onRequestClone);

  const views: { value: PolicyView; label: string }[] = [
    { value: 'rules', label: t('viewRules') },
    { value: 'sod', label: t('viewSod') },
    { value: 'history', label: t('viewHistory') },
  ];

  return (
    <>
      <Sheet open={Boolean(policy)} onOpenChange={onOpenChange}>
        <SheetContent className="overflow-y-auto p-6">
          <SheetTitle>
            {policy?.policyKey}{' '}
            <span className="text-sm font-normal text-muted-foreground">
              v{policy?.version} · {policy?.status}
            </span>
          </SheetTitle>
          <SheetDescription>
            {editable
              ? t('editableHint')
              : isDraft
                ? t('draftReadOnlyHint')
                : t('versionReadOnlyHint')}
          </SheetDescription>

          {detail.data ? (
            <>
              {/* Lifecycle actions — the one primary action per state, permission-gated. */}
              <div className="mt-5 flex flex-wrap gap-2">
                {isDraft && canManage ? (
                  <Button onClick={() => setAction('submit-review')}>{t('submitForReview')}</Button>
                ) : null}
                {policy?.status === 'IN_REVIEW' && canPublish ? (
                  <Button onClick={() => setAction('schedule')}>{t('schedule')}</Button>
                ) : null}
                {policy?.status === 'SCHEDULED' && canPublish ? (
                  <Button onClick={() => setAction('activate')}>{t('activate')}</Button>
                ) : null}
                {policy?.status === 'ACTIVE' && canPublish ? (
                  <Button variant="outline" onClick={() => setAction('retire')}>
                    {t('retire')}
                  </Button>
                ) : null}
                {canCloneThis ? (
                  <Button variant="outline" onClick={() => policy && onRequestClone?.(policy)}>
                    {t('clone')}
                  </Button>
                ) : null}
              </div>

              <div className="mt-5">
                <ViewSwitcher
                  items={views}
                  value={view}
                  onValueChange={(next) => setView(next as PolicyView)}
                  aria-label={t('viewsLabel')}
                />
              </div>

              {view === 'rules' ? (
                <section className="mt-5 space-y-5" aria-label={t('viewRules')}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('colRule')}</TableHead>
                        <TableHead>{t('colTransaction')}</TableHead>
                        <TableHead>{t('colTransition')}</TableHead>
                        <TableHead>{t('colRole')}</TableHead>
                        <TableHead className="text-end">{t('colPriority')}</TableHead>
                        {editable ? <TableHead className="text-end">{t('colActions')}</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.data.rules.length === 0 ? (
                        <TableEmpty colSpan={editable ? 6 : 5}>{t('noRules')}</TableEmpty>
                      ) : (
                        detail.data.rules.map((rule, index) => {
                          const matrix = policyMatrixFor(rule.transactionType);
                          return (
                            <TableRow key={rule.id}>
                              <TableCell className="font-mono text-xs">{rule.ruleKey}</TableCell>
                              <TableCell className="text-sm">
                                {matrix?.label ?? rule.transactionType ?? '—'}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {matrix?.transition ??
                                  (rule.configuration.fromState && rule.configuration.toState
                                    ? `${rule.configuration.fromState} → ${rule.configuration.toState}`
                                    : '—')}
                              </TableCell>
                              <TableCell className="text-sm">
                                {rule.configuration.requiredRole ?? '—'}
                              </TableCell>
                              <TableCell className="text-end tabular-nums">{rule.priority}</TableCell>
                              {editable ? (
                                <TableCell className="space-x-1 text-end whitespace-nowrap">
                                  <Button variant="ghost" onClick={() => setEditing(rule)}>
                                    {t('edit')}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    disabled={index === 0}
                                    onClick={() => move(rule.id, -1)}
                                  >
                                    {t('up')}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    disabled={index === detail.data.rules.length - 1}
                                    onClick={() => move(rule.id, 1)}
                                  >
                                    {t('down')}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    onClick={() =>
                                      window.confirm(t('confirmDelete', { ruleKey: rule.ruleKey })) &&
                                      remove.mutate({ policyId: policy!.id, ruleId: rule.id })
                                    }
                                  >
                                    {t('delete')}
                                  </Button>
                                </TableCell>
                              ) : null}
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>

                  {editable ? (
                    <>
                      <section
                        aria-labelledby="add-rule-heading"
                        className="rounded-panel border border-border p-4"
                      >
                        <h3 id="add-rule-heading" className="text-sm font-semibold text-foreground">
                          {t('addRuleHeading')}
                        </h3>
                        <p className="mt-1 text-caption text-muted-foreground">{t('addRuleHint')}</p>
                        <div className="mt-4">
                          <PolicyAddRuleForm policyId={policy!.id} />
                        </div>
                      </section>

                      <section className="rounded-panel border border-border p-4">
                        <Button variant="outline" onClick={() => policy && validate.mutate(policy.id)}>
                          {t('validate')}
                        </Button>
                        {validate.data ? (
                          <Alert
                            className="mt-3"
                            variant={validate.data.valid ? 'success' : 'error'}
                            messages={
                              validate.data.valid
                                ? [t('validationPassed')]
                                : validate.data.issues.map((issue) => issue.message)
                            }
                          />
                        ) : null}
                      </section>
                    </>
                  ) : null}
                </section>
              ) : null}

              {view === 'sod' && policy ? (
                <section className="mt-5" aria-label={t('viewSod')}>
                  <PolicySodEditor policyId={policy.id} editable={editable} />
                </section>
              ) : null}

              {view === 'history' && policy ? (
                <section className="mt-5" aria-label={t('viewHistory')}>
                  <PolicyHistoryTimeline policyId={policy.id} />
                </section>
              ) : null}
            </>
          ) : detail.isError ? (
            <Alert className="mt-5" variant="error" messages={[t('loadFailed')]} />
          ) : (
            <div className="mt-5 h-40 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
          )}
        </SheetContent>
      </Sheet>

      {/* Edit draft rule */}
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>{t('editDescription')}</DialogDescription>
          {editing ? (
            <form onSubmit={saveRule} className="mt-4 space-y-3">
              {editingMatrix ? (
                <Badge tone="info">
                  {editingMatrix.label} · {editingMatrix.transition}
                </Badge>
              ) : null}
              <FormField htmlFor="editRole" label={t('requiredRole')} required>
                <Select
                  id="editRole"
                  name="requiredRole"
                  defaultValue={editing.configuration.requiredRole ?? ''}
                >
                  <option value="" disabled>
                    {t('selectRole')}
                  </option>
                  {(roles.data ?? []).map((role) => (
                    <option key={role.id} value={role.name}>
                      {role.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField htmlFor="editPriority" label={t('priority')} required>
                <Input id="editPriority" name="priority" type="number" min={0} defaultValue={editing.priority} />
              </FormField>
              {editingMatrix?.basis !== null ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField htmlFor="editMin" label={t('minAmount')}>
                    <Input id="editMin" name="minAmount" defaultValue={editing.configuration.minAmount ?? ''} />
                  </FormField>
                  <FormField htmlFor="editMax" label={t('maxAmount')}>
                    <Input id="editMax" name="maxAmount" defaultValue={editing.configuration.maxAmount ?? ''} />
                  </FormField>
                </div>
              ) : null}
              {update.error ? (
                <Alert
                  variant="error"
                  messages={
                    update.error instanceof ApiError && update.error.messages.length > 0
                      ? update.error.messages
                      : [t('saveFailed')]
                  }
                />
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={update.isPending}>
                  {t('saveRule')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Lifecycle transition */}
      <Dialog open={Boolean(action)} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent>
          {action ? (
            <form onSubmit={submitAction}>
              <DialogTitle>{LIFECYCLE_COPY[action].title}</DialogTitle>
              <DialogDescription>{LIFECYCLE_COPY[action].description}</DialogDescription>
              <div className="mt-4 space-y-3">
                <FormField htmlFor="reason" label={t('decisionReason')} required>
                  <Input
                    id="reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    required
                    minLength={3}
                  />
                </FormField>
                {LIFECYCLE_COPY[action].needsDate ? (
                  <FormField htmlFor="effectiveFrom" label={t('effectiveDate')} required>
                    <Input
                      id="effectiveFrom"
                      type="datetime-local"
                      value={effectiveFrom}
                      onChange={(event) => setEffectiveFrom(event.target.value)}
                      required
                    />
                  </FormField>
                ) : null}
                {transition.error ? (
                  <Alert
                    variant="error"
                    messages={
                      transition.error instanceof ApiError && transition.error.messages.length > 0
                        ? transition.error.messages
                        : [t('transitionFailed')]
                    }
                  />
                ) : null}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAction(null)}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={transition.isPending}>
                  {LIFECYCLE_COPY[action].button}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
