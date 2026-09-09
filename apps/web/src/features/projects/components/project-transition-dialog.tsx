'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  FormField,
  Textarea,
} from '@erp/ui';
import { useSession } from '@/features/auth/session/use-session';
import { ApprovalPanel } from '@/features/workflows/components/approval-panel';
import { useGatedCommand } from '@/features/workflows/use-gated-command';
import { useProjectReadiness } from '../hooks/use-project';
import { projectKeys } from '../hooks/use-projects';
import { runProjectCommand, type ProjectTransition } from '../api/projects-api';
import type { ProjectCommand } from '../project-actions';

export function ProjectTransitionDialog({
  projectId,
  command,
  onDismiss,
}: {
  projectId: string;
  command: ProjectCommand;
  onDismiss: () => void;
}) {
  const t = useTranslations('platform.projects.transition');
  const actions = useTranslations('platform.projects.actions');
  const prep = useTranslations('platform.projects.preparation');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const readiness = useProjectReadiness(projectId, command);
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [waivers, setWaivers] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const submitted = useRef<ProjectTransition | null>(null);
  const inFlight = useRef(false);
  const gate = useGatedCommand((transition: ProjectTransition) =>
    runProjectCommand(projectId, transition),
  );
  const { user } = useSession();
  const apex =
    command === 'start' && Boolean(user?.roles.some((role) => role === 'CFO' || role === 'CEO'));
  const canWaive = (condition: { severity: string; code: string }) =>
    condition.severity === 'WAIVABLE' ||
    (apex && ['ACTIVE_MAIN_CONTRACT', 'CONTRACT_START_DATE'].includes(condition.code));
  const needsDate = command === 'start' || command === 'close';
  const conditions = readiness.data?.conditions.filter((condition) => !condition.satisfied) ?? [];
  const blockers = conditions.filter((condition) => !canWaive(condition));
  const waiverConditions = conditions.filter((condition) => canWaive(condition));
  const preventPending = (event: Event) => {
    if (gate.pending) event.preventDefault();
  };

  async function submit() {
    if (inFlight.current || readiness.isPending || readiness.isError) return;
    setAttempted(true);
    if (
      !submitted.current &&
      ((needsDate && !date) ||
        (command === 'close' && !note.trim()) ||
        blockers.length > 0 ||
        waiverConditions.some((condition) => !waivers[condition.code]?.trim()))
    )
      return;
    const overrides = waiverConditions.map((condition) => ({
      condition: condition.code,
      reason: waivers[condition.code]?.trim() ?? '',
    }));
    const transition: ProjectTransition =
      submitted.current ??
      (command === 'start'
        ? {
            command,
            evidence: {
              actualStartDate: date,
              ...(note.trim() ? { commencementNote: note.trim() } : {}),
              ...(overrides.length ? { overrides } : {}),
            },
          }
        : command === 'close'
          ? {
              command,
              evidence: {
                closureDate: date,
                closureSummary: note.trim(),
                ...(overrides.length ? { overrides } : {}),
              },
            }
          : { command });
    inFlight.current = true;
    try {
      const result = await gate.run(transition);
      if (result.gated) submitted.current = transition;
      else {
        await Promise.all(
          ['projects', 'contracts', 'commercial'].map((scope) =>
            queryClient.invalidateQueries({
              queryKey: scope === 'projects' ? projectKeys.all : [scope],
            }),
          ),
        );
        onDismiss();
      }
    } catch {
      // The shared gate presents API errors and leaves the entered evidence intact.
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !gate.pending) onDismiss();
      }}
    >
      <DialogContent
        onEscapeKeyDown={preventPending}
        onPointerDownOutside={preventPending}
        onInteractOutside={preventPending}
      >
        <DialogTitle>{actions(command)}</DialogTitle>
        <DialogDescription>{t(`description.${command}`)}</DialogDescription>
        <div className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto">
          {readiness.isPending ? <p role="status">{common('loading')}</p> : null}
          {readiness.isError ? (
            <Alert variant="error" messages={[prep('loadFailed')]}>
              <Button variant="outline" onClick={() => readiness.refetch()}>
                {common('grid.retry')}
              </Button>
            </Alert>
          ) : null}
          {blockers.length > 0 ? (
            <Alert
              variant="warning"
              messages={blockers.map((condition) =>
                prep.has(`conditions.${condition.code}`)
                  ? prep(`conditions.${condition.code}`)
                  : condition.detail,
              )}
            />
          ) : null}
          {readiness.data?.deferred.length ? (
            <details open>
              <summary className="cursor-pointer text-body-sm text-muted-foreground">
                {t('deferred')}
              </summary>
              <ul className="mt-2 space-y-2 text-caption text-muted-foreground">
                {readiness.data.deferred.map((code) => (
                  <li key={code}>{t.has(`checks.${code}`) ? t(`checks.${code}`) : code}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {needsDate ? (
            <FormField
              htmlFor="transition-date"
              label={t(command === 'start' ? 'actualStartDate' : 'closureDate')}
              required
              error={attempted && !date ? t('dateRequired') : undefined}
            >
              <DatePicker
                id="transition-date"
                value={date}
                onChange={setDate}
                disabled={gate.pending || Boolean(gate.approvalInstanceId)}
              />
            </FormField>
          ) : null}
          {needsDate ? (
            <FormField
              htmlFor="transition-note"
              label={t(command === 'close' ? 'closureSummary' : 'commencementNote')}
              required={command === 'close'}
              error={
                attempted && command === 'close' && !note.trim() ? t('summaryRequired') : undefined
              }
            >
              <Textarea
                id="transition-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={command === 'close' ? 2000 : 500}
                disabled={gate.pending || Boolean(gate.approvalInstanceId)}
              />
            </FormField>
          ) : null}
          {waiverConditions.map((condition) => (
            <FormField
              key={condition.code}
              htmlFor={`waiver-${condition.code}`}
              label={
                prep.has(`conditions.${condition.code}`)
                  ? prep(`conditions.${condition.code}`)
                  : condition.detail
              }
              hint={t('waiverHint')}
              required
              error={
                attempted && !waivers[condition.code]?.trim() ? t('waiverRequired') : undefined
              }
            >
              <Textarea
                id={`waiver-${condition.code}`}
                value={waivers[condition.code] ?? ''}
                maxLength={500}
                disabled={gate.pending || Boolean(gate.approvalInstanceId)}
                onChange={(event) =>
                  setWaivers({ ...waivers, [condition.code]: event.target.value })
                }
              />
            </FormField>
          ))}
          {gate.approvalInstanceId ? (
            <>
              <Alert variant="info" messages={[t('awaitingApproval'), t('retryApproval')]} />
              <ApprovalPanel instanceId={gate.approvalInstanceId} />
            </>
          ) : null}
          {gate.error ? <Alert variant="error" messages={[gate.error]} /> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onDismiss} disabled={gate.pending}>
            {common('cancel')}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={
              gate.pending || readiness.isPending || readiness.isError || blockers.length > 0
            }
          >
            {gate.pending
              ? actions('working')
              : gate.approvalInstanceId
                ? t('complete')
                : actions(command)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
