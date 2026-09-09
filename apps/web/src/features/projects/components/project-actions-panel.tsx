'use client';

import { useSession } from '@/features/auth/session/use-session';
import { useState } from 'react';
import { ProjectTransitionDialog } from './project-transition-dialog';
import { useProjectReadiness } from '../hooks/use-project';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, DotsThree } from '@phosphor-icons/react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';

import { useCancelProject, useResumeProject, useSuspendProject } from '../hooks/use-project';
import { PROJECT_PERMISSIONS } from '../permissions';
import { getAvailableActions, type ProjectCommand } from '../project-actions';
import type { ProjectDetail } from '../types';

type PendingAction =
  { kind: 'advance'; command: ProjectCommand } | { kind: 'cancel' } | { kind: 'suspend' };

/** Server readiness guides commencement. Every transition is checked again by the API. */
export function ProjectActionsPanel({ project }: { project: ProjectDetail }) {
  const t = useTranslations('platform.projects.actions');
  const { can } = usePermissions();
  const { user } = useSession();
  const actions = getAvailableActions(project);

  const [pending, setPending] = useState<PendingAction | null>(null);

  const readiness = useProjectReadiness(project.id, 'start', project.status === 'DRAFT');
  const cancel = useCancelProject(project.id);
  const suspend = useSuspendProject(project.id);
  const resume = useResumeProject(project.id);

  const activeMutation = pending?.kind === 'cancel' ? cancel : suspend;

  const close = () => {
    activeMutation.reset();
    setPending(null);
  };

  const confirm = (reason: string) => {
    if (!pending) return;

    const onDone = {
      onSuccess: () => {
        setPending(null);
      },
    };

    if (pending.kind === 'cancel') cancel.mutate(reason, onDone);
    else suspend.mutate(reason, onDone);
  };

  const dialogTitle = () => {
    if (!pending) return '';
    const action =
      pending.kind === 'advance'
        ? t(pending.command)
        : pending.kind === 'cancel'
          ? t('cancel')
          : t('suspend');
    return t('confirmTitle', { action });
  };

  const dialogDescription = () => {
    if (!pending || pending.kind === 'advance') return '';
    if (pending.kind === 'cancel') return t('confirmCancel');
    return t('cancelReasonHint');
  };

  // Hooks above, gate below: the mutation hooks must run on every render regardless.
  if (!can(PROJECT_PERMISSIONS.manage)) return null;

  // Readiness only speaks for the one command it gates. Every later transition (practical
  // completion, closeout, close) is offered on its own terms.
  const gatedByReadiness = actions.advance === 'start';
  const apex = user?.roles.some((role) => role === 'CFO' || role === 'CEO');
  const mandatoryBlockers = readiness.data?.conditions.some(
    (condition) =>
      !condition.satisfied &&
      condition.severity === 'MANDATORY' &&
      !(apex && ['ACTIVE_MAIN_CONTRACT', 'CONTRACT_START_DATE'].includes(condition.code)),
  );
  const setupHref =
    gatedByReadiness && mandatoryBlockers
      ? `/projects/${project.id}#project-readiness-title`
      : null;
  const holdForReadiness = gatedByReadiness && (readiness.isPending || readiness.isError);

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {setupHref ? (
          <Button asChild>
            <Link href={setupHref} className="gap-2">
              {t('continueSetup')}
              <ArrowRight size={16} className="rtl:rotate-180" aria-hidden="true" />
            </Link>
          </Button>
        ) : actions.advance && !holdForReadiness ? (
          <Button
            onClick={() => {
              setPending({ kind: 'advance', command: actions.advance! });
            }}
          >
            {t(actions.advance)}
          </Button>
        ) : null}

        {actions.canResume ? (
          <Button
            variant="outline"
            onClick={() => {
              resume.mutate(undefined);
            }}
            disabled={resume.isPending}
          >
            {resume.isPending ? t('working') : t('resume')}
          </Button>
        ) : null}

        {actions.canEdit || actions.canSuspend || actions.canCancel ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('more')} title={t('more')}>
                <DotsThree size={20} weight="bold" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.canEdit ? (
                <DropdownMenuItem asChild>
                  <Link href={`/projects/${project.id}/edit`}>{t('editInformation')}</Link>
                </DropdownMenuItem>
              ) : null}
              {actions.canEdit && (actions.canSuspend || actions.canCancel) ? (
                <DropdownMenuSeparator />
              ) : null}
              {actions.canSuspend ? (
                <DropdownMenuItem onSelect={() => setPending({ kind: 'suspend' })}>
                  {t('suspend')}
                </DropdownMenuItem>
              ) : null}
              {actions.canSuspend && actions.canCancel ? <DropdownMenuSeparator /> : null}
              {actions.canCancel ? (
                <DropdownMenuItem destructive onSelect={() => setPending({ kind: 'cancel' })}>
                  {t('cancel')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {resume.isError ? (
        <p className="mt-3 w-full text-sm text-danger" role="alert">
          {errorText(resume.error, t('failed'))}
        </p>
      ) : null}

      {pending?.kind === 'advance' ? (
        <ProjectTransitionDialog
          projectId={project.id}
          command={pending.command}
          onDismiss={() => setPending(null)}
        />
      ) : pending ? (
        <ConfirmActionDialog
          title={dialogTitle()}
          description={dialogDescription()}
          confirmLabel={t(pending.kind === 'cancel' ? 'cancel' : 'suspend')}
          // Cancel and suspend both record a reason; the API requires the field and it is
          // the only explanation that reaches the audit trail.
          reason={{
            required: true,
            ...(pending.kind === 'cancel' ? { hint: t('cancelReasonHint') } : {}),
          }}
          isPending={activeMutation.isPending}
          errorMessage={
            activeMutation.isError ? errorText(activeMutation.error, t('failed')) : undefined
          }
          onConfirm={confirm}
          onDismiss={close}
        />
      ) : null}
    </>
  );
}

/**
 * Prefers the server's explanation over a generic message. The API returns useful text for
 * these failures — "Project is suspended. Resume it before changing status." says more
 * than "that action could not be completed".
 */
function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages.join(' ');
  return fallback;
}
