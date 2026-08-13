'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';

import {
  useBaselineVersion,
  useCancelDraftVersion,
  useCreateDraftVersion,
} from '../hooks/use-boq';
import type { Boq, BoqVersion } from '../types';
import { getVersionActions } from '../version-actions';

type Pending = 'baseline' | 'cancelDraft' | 'createDraft';

interface BoqVersionActionsProps {
  projectId: string;
  boq: Boq;
  selected: BoqVersion | null;
  /** True when the selected version has no items — baselining that is worth warning about. */
  isEmpty: boolean;
}

export function BoqVersionActions({
  projectId,
  boq,
  selected,
  isEmpty,
}: BoqVersionActionsProps) {
  const t = useTranslations('platform.boq.versionActions');
  const actions = getVersionActions(boq, selected, isEmpty);

  const [pending, setPending] = useState<Pending | null>(null);

  const baseline = useBaselineVersion(projectId);
  const cancelDraft = useCancelDraftVersion(projectId);
  const createDraft = useCreateDraftVersion(projectId);

  const active =
    pending === 'baseline' ? baseline : pending === 'cancelDraft' ? cancelDraft : createDraft;

  const close = () => {
    active.reset();
    setPending(null);
  };

  const confirm = (notes: string) => {
    const done = { onSuccess: () => { setPending(null); } };

    if (pending === 'baseline' && selected) baseline.mutate(selected.id, done);
    else if (pending === 'cancelDraft' && selected) cancelDraft.mutate(selected.id, done);
    else if (pending === 'createDraft') createDraft.mutate(notes, done);
  };

  if (!actions.canBaseline && !actions.canCancelDraft && !actions.canCreateDraft) return null;

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        {actions.canBaseline ? (
          <Button
            onClick={() => {
              setPending('baseline');
            }}
          >
            {t('baseline')}
          </Button>
        ) : null}

        {actions.canCreateDraft ? (
          <Button
            onClick={() => {
              setPending('createDraft');
            }}
          >
            {t('createDraft')}
          </Button>
        ) : null}

        {actions.canCancelDraft ? (
          <Button
            variant="destructive"
            onClick={() => {
              setPending('cancelDraft');
            }}
          >
            {t('cancelDraft')}
          </Button>
        ) : null}
      </div>

      {pending ? (
        <ConfirmActionDialog
          title={t(titleKey(pending))}
          description={describe(pending, actions, t)}
          // A short verb, distinct from the trigger label — two buttons sharing an
          // accessible name inside a modal is ambiguous to screen readers.
          confirmLabel={t(confirmKey(pending))}
          // Only a revision takes notes, and they are optional server-side.
          reason={
            pending === 'createDraft'
              ? { required: false, label: t('notesLabel'), hint: t('notesHint'), maxLength: 1000 }
              : undefined
          }
          isPending={active.isPending}
          errorMessage={active.isError ? errorText(active.error, t('failed')) : undefined}
          onConfirm={confirm}
          onDismiss={close}
        />
      ) : null}
    </>
  );
}

function confirmKey(pending: Pending): string {
  if (pending === 'baseline') return 'confirmBaselineAction';
  if (pending === 'cancelDraft') return 'confirmCancelAction';
  return 'confirmCreateAction';
}

function titleKey(pending: Pending): string {
  if (pending === 'baseline') return 'confirmBaselineTitle';
  if (pending === 'cancelDraft') return 'confirmCancelTitle';
  return 'confirmCreateTitle';
}

/**
 * Baselining says more than the other two, because it carries consequences the button
 * label cannot: it supersedes the current approved version, it is the point after which
 * editing requires a revision, and on the first baseline it permanently fixes the original
 * contract BOQ. An empty draft is called out too — the API allows it, and approving an
 * empty Bill of Quantities is almost always a mistake.
 */
function describe(
  pending: Pending,
  actions: ReturnType<typeof getVersionActions>,
  t: (key: string) => string,
): string {
  if (pending === 'cancelDraft') return t('confirmCancelDraft');
  if (pending === 'createDraft') return t('confirmCreateDraft');

  return [
    t('confirmBaseline'),
    actions.isFirstBaseline ? t('confirmFirstBaseline') : null,
    actions.wouldBaselineEmpty ? t('confirmBaselineEmpty') : null,
  ]
    .filter(Boolean)
    .join(' ');
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages.join(' ');
  return fallback;
}
