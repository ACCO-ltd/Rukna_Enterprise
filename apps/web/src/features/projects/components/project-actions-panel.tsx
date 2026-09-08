'use client';

import { useState } from 'react';
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

import {
  useAdvanceProject,
  useCancelProject,
  useResumeProject,
  useSuspendProject,
} from '../hooks/use-project';
import { PROJECT_PERMISSIONS } from '../permissions';
import { getAvailableActions, type ProjectCommand } from '../project-actions';
import type { ProjectDetail, ProjectWorkspaceSummary } from '../types';

type ProjectSetup = ProjectWorkspaceSummary['setup'];

type PendingAction = { kind: 'advance'; command: ProjectCommand } | { kind: 'cancel' } | { kind: 'suspend' };

/** Confirmation copy per lifecycle command — each says what the step actually commits to. */
const CONFIRM_KEY: Record<ProjectCommand, string> = {
  start: 'confirmStart',
  'practical-completion': 'confirmPracticalCompletion',
  closeout: 'confirmCloseout',
  close: 'confirmClose',
};

/**
 * The first setup step a reader can actually act on, in the order the steps unlock.
 *
 * BOQ first because the contract is gated behind a baselined BOQ; the team last because it is
 * the only step with no prerequisite and no dependants. Returns null when nothing is left,
 * which is what turns the header CTA from "Continue setup" into "Start project".
 */
function nextSetupHref(projectId: string, setup: ProjectSetup): string | null {
  if (!setup.boqBaselined) return `/projects/${projectId}/boq`;
  if (setup.mainContractApplicable && !setup.mainContractExists) {
    return `/projects/${projectId}/commercial/contract/new`;
  }
  if (!setup.teamReady) return `/projects/${projectId}/members`;
  return null;
}

/**
 * The project's action set, rendered in the workspace header on every tab.
 *
 * Two rules shape it:
 *
 * **The primary control follows readiness.** A draft whose BOQ is not baselined cannot start,
 * and the server rejects the command — so offering "Start project" there is a button that
 * exists to fail. While preparation is unfinished the CTA is "Continue setup" and it goes to
 * the next step that is actually open; it becomes "Start project" only once the last one is
 * done. The server stays the authority (`constraints.md:299`); this decides what to *offer*,
 * never whether the transition is legal.
 *
 * **"Edit" is not a project-level verb.** Edit what — the metadata, the lifecycle, the
 * contract, the scope? It moved into the overflow as "Edit project information", which says
 * which of those it means.
 *
 * **Nothing renders without `manage:project`.** Every route behind these controls carries
 * `@RequirePermissions(PERMISSIONS.projectsManage)` — `PATCH /projects/:id` and all seven
 * lifecycle commands — and until now the UI gated only on lifecycle status, so a read-only
 * member saw "Start project" and discovered their own permissions by collecting a 403. The API
 * stays the security boundary; this stops advertising what it will refuse.
 */
export function ProjectActionsPanel({
  project,
  setup,
}: {
  project: ProjectDetail;
  /**
   * The workspace summary's readiness block. `undefined` while it is still loading — the CTA
   * is held back rather than rendering "Start project" and swapping it a moment later. `null`
   * when the summary could not be read, in which case the lifecycle command is offered as
   * before and the server decides.
   */
  setup?: ProjectSetup | null;
}) {
  const t = useTranslations('platform.projects.actions');
  const { can } = usePermissions();
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

  // Hooks above, gate below: the mutation hooks must run on every render regardless.
  if (!can(PROJECT_PERMISSIONS.manage)) return null;

  // Readiness only speaks for the one command it gates. Every later transition (practical
  // completion, closeout, close) is offered on its own terms.
  const gatedByReadiness = actions.advance === 'start';
  const setupHref = gatedByReadiness && setup ? nextSetupHref(project.id, setup) : null;
  const holdForReadiness = gatedByReadiness && setup === undefined;

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
