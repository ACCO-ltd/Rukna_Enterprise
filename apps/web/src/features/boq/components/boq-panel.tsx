'use client';

import { useState } from 'react';
import { BoqVersionStatus } from '@erp/types';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge, Button, Label, Select } from '@erp/ui';
import { ClipboardText, Plus, TreeStructure } from '@phosphor-icons/react';

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
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4" aria-hidden="true">
          <div className="h-11 animate-pulse rounded-lg bg-muted" />
          <div className="h-48 animate-pulse rounded-lg bg-muted" />
        </div>
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
    <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center shadow-[var(--shadow-panel)]">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
        <ClipboardText size={25} weight="duotone" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-foreground">{t('notInitialized')}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t('notInitializedHint')}</p>

      {isError ? (
        <div className="mx-auto mt-4 max-w-md">
          <Alert variant="error" messages={[t('initializeFailed')]} />
        </div>
      ) : null}

      <div className="mt-4">
        <Button className="gap-2"
          onClick={() => {
            mutate();
          }}
          disabled={isPending}
        >
          <Plus size={16} aria-hidden="true" />
          {isPending ? t('initializing') : t('initialize')}
        </Button>
      </div>
    </div>
  );
}

const BOQ_STATUS_STAGES: BoqVersionStatus[] = [
  BoqVersionStatus.DRAFT,
  BoqVersionStatus.BASELINED,
];

function BoqStatusStrip({ currentStatus }: { currentStatus: BoqVersionStatus }) {
  const t = useTranslations('platform.boq');

  return (
    <div className="flex items-center gap-0">
      {BOQ_STATUS_STAGES.map((stage, index) => {
        const isLast = index === BOQ_STATUS_STAGES.length - 1;
        const isActive = stage === currentStatus;
        const isPast = BOQ_STATUS_STAGES.indexOf(currentStatus) > index;

        return (
          <div key={stage} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-all',
                  isActive ? 'bg-brand-primary text-white ring-4 ring-brand-primary/15' : '',
                  isPast ? 'bg-brand-primary/40 text-white' : '',
                  !isActive && !isPast ? 'border border-border bg-surface text-muted-foreground' : '',
                ].filter(Boolean).join(' ')}
              />
              <span
                className={[
                  'text-[10.5px] font-medium leading-none',
                  isActive ? 'text-brand-primary' : 'text-muted-foreground/60',
                ].join(' ')}
              >
                {t(`versionStatus.${stage}`)}
              </span>
            </div>
            {!isLast ? (
              <div
                className={[
                  'mb-3.5 h-px w-8 flex-shrink-0',
                  isPast || isActive ? 'bg-brand-primary/40' : 'bg-border',
                ].join(' ')}
              />
            ) : null}
          </div>
        );
      })}
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

  const currentVersionStatus = selected?.status ?? boq.versions[0]?.status ?? BoqVersionStatus.DRAFT;
  // Only show DRAFT and BASELINED in the strip — SUPERSEDED and CANCELLED are historical
  // states not part of the primary progression flow.
  const stripStatus = [BoqVersionStatus.DRAFT, BoqVersionStatus.BASELINED].includes(currentVersionStatus)
    ? currentVersionStatus
    : BoqVersionStatus.BASELINED;

  return (
    <div className="space-y-5">
      {boq.versions.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface px-4 py-3 shadow-[var(--shadow-panel)] [-webkit-overflow-scrolling:touch]">
          <BoqStatusStrip currentStatus={stripStatus} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-panel)] sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-6 hidden h-9 w-9 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary sm:flex">
            <TreeStructure size={19} weight="duotone" aria-hidden="true" />
          </span>
          <div>
          <Label htmlFor="boq-version">{t('versionSelectLabel')}</Label>
          <Select
            id="boq-version"
            className="mt-2 w-auto min-w-64"
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
        </div>

        {selected ? (
          <div className="ms-auto text-xs text-muted-foreground">
            {isDraft ? (
              <Badge tone="info">{t('draftBadge')}</Badge>
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
        <BoqVersionActions
          projectId={projectId}
          boq={boq}
          selected={selected}
          isEmpty={(nodes?.length ?? 0) === 0}
        />
      </div>

      {selected?.notes ? (
        <div className="rounded-lg border border-border bg-surface px-5 py-4 shadow-[var(--shadow-control)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('notes')}
          </p>
          <p className="mt-1 text-sm text-foreground">{selected.notes}</p>
        </div>
      ) : null}

      {isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div className="space-y-2 rounded-xl border border-border bg-surface p-4" aria-hidden="true">
            <div className="h-10 animate-pulse rounded bg-muted" />
            <div className="h-12 animate-pulse rounded bg-muted" />
            <div className="h-12 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ) : isError ? (
        <Alert
          variant="error"
          messages={[error instanceof ApiError && error.messages.length > 0 ? error.messages[0]! : t('loadFailed')]}
        />
      ) : nodes.length === 0 && !isDraft ? (
    <div className="rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center shadow-[var(--shadow-control)]">
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
