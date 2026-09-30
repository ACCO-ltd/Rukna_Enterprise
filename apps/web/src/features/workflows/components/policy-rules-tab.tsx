'use client';

import { type FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Input,
  OverflowGlyph,
  RowActions,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { useRoles } from '@/features/roles/hooks/use-roles';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';
import type { ApprovalPolicyDetail } from '../api/workflows-api';
import {
  useDeleteApprovalPolicyRule,
  useReorderApprovalPolicyRules,
  useUpdateApprovalPolicyRule,
} from '../hooks/use-approval-policies';
import { policyMatrixFor } from '../policy-matrix';
import { PolicyAddRuleForm } from './policy-add-rule-form';

type PolicyRule = ApprovalPolicyDetail['rules'][number];

/**
 * Rules tab — the priority-ordered rule set of a policy version, moved out of the retired
 * builder sheet onto its own full-page tab.
 *
 * Write affordances render only when `editable` (DRAFT + `manage:workflow`, decided by the
 * workspace shell): the per-row edit / reorder / delete cluster consolidates into a single
 * `RowActions` overflow (matching Users and Roles), and the add-rule form + matrix hint sit
 * below the table. On a fresh empty draft the add form is expanded inline — there is nothing
 * else to do. A published version or a viewer sees the table only.
 *
 * The Validate action does not live here — it moved to the workspace validation rail so it is
 * reachable from every tab.
 */
export function PolicyRulesTab({
  policyId,
  rules,
  editable,
}: {
  policyId: string;
  rules: PolicyRule[];
  editable: boolean;
}) {
  const t = useTranslations('platform.workflows.policies.builder');
  const roles = useRoles();
  const update = useUpdateApprovalPolicyRule();
  const remove = useDeleteApprovalPolicyRule();
  const reorder = useReorderApprovalPolicyRules();

  const [editing, setEditing] = useState<PolicyRule | null>(null);
  const [ruleTouched, setRuleTouched] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PolicyRule | null>(null);

  function move(id: string, offset: -1 | 1) {
    const ids = rules.map((rule) => rule.id);
    const i = ids.indexOf(id);
    if (i + offset < 0 || i + offset >= ids.length) return;
    [ids[i], ids[i + offset]] = [ids[i + offset], ids[i]];
    reorder.mutate({ id: policyId, ruleIds: ids });
  }

  function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const matrix = policyMatrixFor(editing.transactionType);
    const form = new FormData(event.currentTarget);
    update.mutate(
      {
        policyId,
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
      { onSuccess: () => closeEditor() },
    );
  }

  function closeEditor() {
    setEditing(null);
    setRuleTouched(false);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    remove.mutate(
      { policyId, ruleId: deleteTarget.id },
      {
        onSuccess: () => {
          setDeleteTarget(null);
          remove.reset();
        },
        // Error stays on the dialog via deleteError below.
      },
    );
  }

  const deleteError =
    remove.error instanceof ApiError && remove.error.messages.length > 0
      ? remove.error.messages[0]
      : remove.error
        ? t('deleteFailed')
        : undefined;

  const editingMatrix = policyMatrixFor(editing?.transactionType);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-caption text-muted-foreground">{t('addRuleHint')}</p>
      </div>

      <TableScroll aria-label={t('viewRules')}>
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
            {rules.length === 0 ? (
              <TableEmpty colSpan={editable ? 6 : 5}>{t('noRules')}</TableEmpty>
            ) : (
              rules.map((rule, index) => {
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
                      <TableCell className="text-end">
                        <RowActions
                          overflow={
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={t('colActions')}
                                >
                                  <OverflowGlyph />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => setEditing(rule)}>
                                  {t('edit')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={index === 0}
                                  onSelect={() => move(rule.id, -1)}
                                >
                                  {t('up')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={index === rules.length - 1}
                                  onSelect={() => move(rule.id, 1)}
                                >
                                  {t('down')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  destructive
                                  onSelect={() => {
                                    remove.reset();
                                    setDeleteTarget(rule);
                                  }}
                                >
                                  {t('delete')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          }
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableScroll>

      {editable ? (
        <section
          aria-labelledby="add-rule-heading"
          className="rounded-panel border border-border p-4"
        >
          <h3 id="add-rule-heading" className="text-sm font-semibold text-foreground">
            {t('addRuleHeading')}
          </h3>
          <div className="mt-4">
            <PolicyAddRuleForm policyId={policyId} />
          </div>
        </section>
      ) : null}

      {/* Edit draft rule — matrix-pinned, exactly as the retired sheet. */}
      {/* A FormDialog (ADR-039), size md. The fields stay uncontrolled (read on submit), so an
          edit is noticed by the input events it raises — enough to ask before discarding it. */}
      <FormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        size="md"
        title={t('editTitle')}
        subtitle={t('editDescription')}
        dirty={ruleTouched}
        busy={update.isPending}
        onSubmit={saveRule}
      >
          {editing ? (
            <>
            <FormDialogBody className="space-y-3" onInput={() => setRuleTouched(true)}>
              {editingMatrix ? (
                <Badge tone="neutral">
                  {editingMatrix.label} · {editingMatrix.transition}
                </Badge>
              ) : null}
              <FormField htmlFor="editRole" label={t('requiredRole')} required>
                <Select
                  id="editRole"
                  name="requiredRole"
                  defaultValue={editing.configuration.requiredRole ?? ''}
                  onChange={() => setRuleTouched(true)}
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
                <Input
                  id="editPriority"
                  name="priority"
                  type="number"
                  min={0}
                  defaultValue={editing.priority}
                />
              </FormField>
              {editingMatrix?.basis !== null ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField htmlFor="editMin" label={t('minAmount')}>
                    <Input
                      id="editMin"
                      name="minAmount"
                      defaultValue={editing.configuration.minAmount ?? ''}
                    />
                  </FormField>
                  <FormField htmlFor="editMax" label={t('maxAmount')}>
                    <Input
                      id="editMax"
                      name="maxAmount"
                      defaultValue={editing.configuration.maxAmount ?? ''}
                    />
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
            </FormDialogBody>
            <FormDialogFooter>
              <FormDialogClose asChild>
                <Button type="button" variant="outline" disabled={update.isPending}>
                  {t('cancel')}
                </Button>
              </FormDialogClose>
              <Button type="submit" disabled={update.isPending}>
                {t('saveRule')}
              </Button>
            </FormDialogFooter>
            </>
          ) : null}
      </FormDialog>

      {/* Delete draft rule — DS confirm dialog, surfacing ApiError.messages on failure. */}
      {deleteTarget ? (
        <ConfirmActionDialog
          title={t('deleteTitle', { ruleKey: deleteTarget.ruleKey })}
          description={t('deleteBody')}
          confirmLabel={t('delete')}
          isPending={remove.isPending}
          errorMessage={deleteError}
          onConfirm={confirmDelete}
          onDismiss={() => {
            setDeleteTarget(null);
            remove.reset();
          }}
        />
      ) : null}
    </div>
  );
}
