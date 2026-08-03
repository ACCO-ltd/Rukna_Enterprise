'use client';

import { useState } from 'react';
import { BoqVersionStatus } from '@erp/types';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, Label, Select } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

import { useProject } from '@/features/projects/hooks/use-project';

import { useBoq, useBoqTree, useInitializeBoq } from '../hooks/use-boq';
import type { Boq } from '../types';
import { BoqEditor } from './boq-editor';
import { BoqTree } from './boq-tree';
import { BoqVersionActions } from './boq-version-actions';

export function BoqPanel({ projectId }: { projectId: string }) {
  const t = useTranslations('platform.boq');
  const tCommon = useTranslations('common');
  const { data: boq, isPending, isError } = useBoq(projectId);

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (isError) return <Alert variant="error" messages={[t('loadFailed')]} />;

  // null means the project has no BOQ yet — a legitimate starting state, not a failure.
  if (boq === null) return <InitializeBoq projectId={projectId} />;

  return <BoqVersions projectId={projectId} boq={boq} />;
}

function InitializeBoq({ projectId }: { projectId: string }) {
  const t = useTranslations('platform.boq');
  const { mutate, isPending, isError } = useInitializeBoq(projectId);

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{t('notInitialized')}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t('notInitializedHint')}</p>

      {isError ? (
        <div className="mx-auto mt-4 max-w-md">
          <Alert variant="error" messages={[t('initializeFailed')]} />
        </div>
      ) : null}

      <div className="mt-4">
        <Button
          onClick={() => {
            mutate();
          }}
          disabled={isPending}
        >
          {isPending ? t('initializing') : t('initialize')}
        </Button>
      </div>
    </div>
  );
}

function BoqVersions({ projectId, boq }: { projectId: string; boq: Boq }) {
  const t = useTranslations('platform.boq');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  // Nodes are denominated in the project's contract currency rather than chosen per node.
  // See node-form.ts and D1. Undefined while loading is treated the same as unset — the
  // editor simply omits the currency, which the API permits.
  const { data: project } = useProject(projectId);
  const projectCurrency = project?.currency ?? null;

  // Default to the draft when there is one, otherwise the approved version, otherwise the
  // newest — the version the user most likely came here to look at.
  const defaultVersionId =
    boq.currentDraftVersionId ?? boq.currentApprovedVersionId ?? boq.versions[0]?.id ?? null;

  const [chosenId, setChosenId] = useState<string | null>(null);

  // Derived during render rather than synchronised in an effect: if the chosen version has
  // gone (a cancelled draft, or one baselined in another tab), fall back to the default.
  // An effect would render one frame pointing at a version that no longer exists.
  const selectedId =
    chosenId && boq.versions.some((v) => v.id === chosenId) ? chosenId : defaultVersionId;

  const selected = boq.versions.find((v) => v.id === selectedId) ?? null;
  const isDraft = selected?.id === boq.currentDraftVersionId;

  const { data: nodes, isPending, isError, error } = useBoqTree(projectId, selectedId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Label htmlFor="boq-version">{t('versionSelectLabel')}</Label>
          <Select
            id="boq-version"
            className="mt-1 w-auto min-w-56"
            value={selectedId ?? ''}
            onChange={(e) => {
              setChosenId(e.target.value);
            }}
          >
            {boq.versions.map((version) => (
              <option key={version.id} value={version.id}>
                {t('versionNumber', { number: version.versionNumber })} —{' '}
                {statusLabel(version.status, t)}
              </option>
            ))}
          </Select>
        </div>

        {selected ? (
          <div className="text-xs text-muted-foreground">
            {isDraft ? (
              <span className="inline-flex items-center rounded-full bg-brand-primary/10 px-2.5 py-0.5 text-xs font-medium text-brand-primary">
                {t('draftBadge')}
              </span>
            ) : (
              <span title={t('readOnlyHint')}>{t('readOnly')}</span>
            )}
            {selected.baselinedAt ? (
              <p className="mt-1">
                {t('baselinedOn', { date: formatDate(selected.baselinedAt, locale) ?? '—' })}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <BoqVersionActions
        projectId={projectId}
        boq={boq}
        selected={selected}
        isEmpty={(nodes?.length ?? 0) === 0}
      />

      {selected?.notes ? (
        <div className="rounded-md border border-border bg-surface-subtle px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('notes')}
          </p>
          <p className="mt-1 text-sm text-foreground">{selected.notes}</p>
        </div>
      ) : null}

      {isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
        </div>
      ) : isError ? (
        <Alert
          variant="error"
          messages={[error instanceof ApiError && error.messages.length > 0 ? error.messages[0]! : t('loadFailed')]}
        />
      ) : nodes.length === 0 && !isDraft ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyBaselinedHint')}</p>
        </div>
      ) : isDraft && selectedId ? (
        // Editing is offered only on the open draft — every node command is refused by the
        // server on any other version.
        <BoqEditor
          projectId={projectId}
          versionId={selectedId}
          nodes={nodes}
          projectCurrency={projectCurrency}
        />
      ) : (
        <BoqTree nodes={nodes} />
      )}
    </div>
  );
}

function statusLabel(status: BoqVersionStatus, t: (key: string) => string): string {
  return t(`versionStatus.${status}`);
}
