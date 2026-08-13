'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DotsThree, PencilSimple } from '@phosphor-icons/react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';

import {
  useAdvanceProject,
  useCancelProject,
  useResumeProject,
  useSuspendProject,
} from '../hooks/use-project';
import { getAvailableActions, type ProjectCommand } from '../project-actions';
import type { ProjectDetail } from '../types';

type PendingAction = { kind: 'advance'; command: ProjectCommand } | { kind: 'cancel' } | { kind: 'suspend' };

/** Confirmation copy per lifecycle command — each says what the step actually commits to. */
const CONFIRM_KEY: Record<ProjectCommand, string> = {
  approve: 'confirmApprove',
  mobilize: 'confirmMobilize',
  activate: 'confirmActivate',
  'practical-completion': 'confirmPracticalCompletion',
  closeout: 'confirmCloseout',
  close: 'confirmClose',
};

export function ProjectActionsPanel({ project }: { project: ProjectDetail }) {
  const t = useTranslations('platform.projects.actions');
  const actions = getAvailableActions(project);

  const [pending, setPending] = useState<PendingAction | null>(null);

  const advance = useAdvanceProject(project.id);
  const cancel = useCancelProject(project.id);
  const suspend = useSuspendProject(project.id);
  const resume = useResumeProject(project.id);

  const activeMutation =
    pending?.kind === 'advance' ? advance : pending?.kind === 'cancel' ? cancel : suspend;

  const close = () => {
    activeMutation.reset();
    setPending(null);
  };

  const confirm = (reason: string) => {
    if (!pending) return;

    const onDone = { onSuccess: () => { setPending(null); } };

    if (pending.kind === 'advance') advance.mutate(pending.command, onDone);
    else if (pending.kind === 'cancel') cancel.mutate(reason, onDone);
    else suspend.mutate(reason, onDone);
  };

  const dialogTitle = () => {
    if (!pending) return '';
    const action =
      pending.kind === 'advance' ? t(pending.command) : pending.kind === 'cancel' ? t('cancel') : t('suspend');
    return t('confirmTitle', { action });
  };

  const dialogDescription = () => {
    if (!pending) return '';
    if (pending.kind === 'advance') return t(CONFIRM_KEY[pending.command]);
    if (pending.kind === 'cancel') return t('confirmCancel');
    return t('cancelReasonHint');
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.advance ? (
          <Button
            onClick={() => {
              setPending({ kind: 'advance', command: actions.advance! });
            }}
          >
            {t(actions.advance)}
          </Button>
        ) : null}

        {actions.canEdit ? (
          <Button variant="outline" asChild>
            <Link href={`/projects/${project.id}/edit`} className="gap-2">
              <PencilSimple size={16} aria-hidden="true" />
              {t('edit')}
            </Link>
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

        {(actions.canSuspend || actions.canCancel) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('more')} title={t('more')}>
                <DotsThree size={20} weight="bold" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
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
        <p className="mt-3 text-sm text-danger" role="alert">
          {errorText(resume.error, t('failed'))}
        </p>
      ) : null}

      {pending ? (
        <ConfirmActionDialog
          title={dialogTitle()}
          description={dialogDescription()}
          confirmLabel={t('confirm')}
          // Cancel and suspend both record a reason; the API requires the field and it is
          // the only explanation that reaches the audit trail.
          reason={
            pending.kind === 'advance'
              ? undefined
              : {
                  required: true,
                  ...(pending.kind === 'cancel' ? { hint: t('cancelReasonHint') } : {}),
                }
          }
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
