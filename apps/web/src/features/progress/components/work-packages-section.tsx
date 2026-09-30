'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Input,
  Select,
  Skeleton,
} from '@erp/ui';

import {
  apportionUnits,
  apportionWeights,
  PROGRESS_WEIGHT_DECIMALS,
  type SuggestedWeightLine,
} from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { usePermissions } from '@/features/auth/permissions/can';

import { useSuggestWeights, useUpdateWorkPackage } from '@/features/programme/hooks/use-programme';
import { useAllocateBoqNode, useCreateWorkPackage, useProjectRollup } from '../hooks/use-progress';
import { lineLabel, useBoqLeaves } from '../hooks/use-boq-leaves';
import { PackageWeightsTable } from './package-weights-table';

/** Which of the editor's actions is the screen's one primary right now, if any. */
export type WorkPackageEditorPrimary = 'allocate' | 'weights' | null;

/**
 * The work-package editor, embedded in Plan & setup's "Work packages" step: the packages with
 * their weights and allocated BOQ items, plus the three editing actions (suggest weights from BOQ
 * values, allocate an item, add a package). The step decides which action is the primary — the
 * one that closes the current gap — and the rest render as secondary, so the screen never shows
 * two primaries. Weights are edited in the table itself (ADR-039: values already in a table are
 * edited there); once one is typed, "Save weights" takes over as the primary. The action bar and
 * the weight inputs are for `manage:project` only.
 */
export function WorkPackageEditor({
  projectId,
  primary,
}: {
  projectId: string;
  primary: WorkPackageEditorPrimary;
}) {
  const t = useTranslations('progress');
  const { can } = usePermissions();
  const canEdit = can('manage:project');
  const { data, isPending, isError, refetch, isFetching } = useProjectRollup(projectId);

  // Weights typed into the table but not saved yet: "Save weights" is then the step's primary.
  const [weightsDirty, setWeightsDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [allocating, setAllocating] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedWeightLine[] | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  // False when the server split evenly (no cost tier) rather than by BOQ value.
  const [valueWeighted, setValueWeighted] = useState(true);

  const suggest = useSuggestWeights(projectId);
  const updateWp = useUpdateWorkPackage(projectId);

  function handleSuggest() {
    setSuggestError(null);
    suggest.mutate(undefined, {
      onSuccess: (res) => {
        setSuggestions(res.weights);
        setValueWeighted(res.valueWeighted);
      },
      onError: (e) =>
        setSuggestError(e instanceof ApiError ? e.message : t('workPackage.suggestFailed')),
    });
  }

  function handleAcceptOne(workPackageId: string, weight: number) {
    updateWp.mutate(
      { workPackageId, body: { progressWeight: Number(weight.toFixed(4)) } },
      {
        onSuccess: () =>
          setSuggestions((prev) => {
            const next = prev?.filter((s) => s.workPackageId !== workPackageId) ?? null;
            return next?.length === 0 ? null : next;
          }),
        onError: (e) =>
          setSuggestError(e instanceof ApiError ? e.message : t('workPackage.saveFailed')),
      },
    );
  }

  function handleAcceptAll() {
    if (!suggestions) return;
    setSuggestError(null);
    // Largest remainder at the stored four places, so the accepted set sums to exactly 1.0000.
    const stored = apportionWeights(
      suggestions.map((w) => w.suggestedWeight),
      PROGRESS_WEIGHT_DECIMALS,
    );
    for (const [index, w] of suggestions.entries()) {
      updateWp.mutate(
        { workPackageId: w.workPackageId, body: { progressWeight: stored[index]! } },
        {
          onError: (e) =>
            setSuggestError(e instanceof ApiError ? e.message : t('workPackage.saveFailed')),
        },
      );
    }
    setSuggestions(null);
  }

  if (isPending) return <Skeleton className="h-40 w-full rounded-panel" aria-hidden="true" />;

  if (isError) {
    return (
      <Alert variant="error" messages={[t('states.loadFailed')]}>
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            {t('actions.retry')}
          </Button>
        </div>
      </Alert>
    );
  }

  const packages = data.packages.map((p) => ({ id: p.id, code: p.code, name: p.name }));
  const nextCode = `WP-${String(data.packages.length + 1).padStart(2, '0')}`;
  const existingWeightPercent = Math.round(Number(data.weightsTotal) * 100);
  // Shown as whole percents that add up to exactly 100 (largest remainder, shared with the API).
  const suggestedPercents = apportionUnits((suggestions ?? []).map((w) => w.suggestedWeight), 2);
  const hasPackages = data.packages.length > 0;

  return (
    <div className="space-y-4">
      {canEdit ? (
      <div className="flex flex-wrap items-center gap-2">
        {hasPackages ? (
          <Button
            variant={primary === 'allocate' && !weightsDirty ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAllocating(true)}
          >
            {t('actions.allocate')}
          </Button>
        ) : null}
        {hasPackages ? (
          <Button
            variant={primary === 'weights' && !weightsDirty ? 'default' : 'outline'}
            size="sm"
            onClick={handleSuggest}
            disabled={suggest.isPending}
          >
            {t('workPackage.suggestWeights')}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
          {t('setupView.workPackages.addManually')}
        </Button>
      </div>
      ) : null}

      {suggestError ? <Alert variant="error" messages={[suggestError]} /> : null}
      {suggestions !== null && !valueWeighted ? (
        <p className="text-caption text-muted-foreground">{t('workPackage.evenWeightsNote')}</p>
      ) : null}

      {suggestions !== null ? (
        <div className="space-y-3 rounded-panel border border-border bg-surface-subtle p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-body font-medium text-foreground">{t('workPackage.proposed.title')}</p>
              <p className="mt-0.5 text-caption text-muted-foreground">{t('workPackage.proposed.hint')}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSuggestions(null)}>
              {t('workPackage.proposed.dismiss')}
            </Button>
          </div>
          <ul className="space-y-1">
            {suggestions.map((s, index) => {
              const pkg = data.packages.find((p) => p.id === s.workPackageId);
              return (
                <li key={s.workPackageId} className="flex items-center justify-between gap-4 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="shrink-0 font-mono text-caption text-muted-foreground">
                      {pkg?.code ?? s.workPackageId}
                    </span>
                    <span className="truncate text-body text-foreground">{pkg?.name ?? s.workPackageId}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="w-10 text-end text-body font-medium tabular-nums text-foreground">
                      {`${suggestedPercents[index]}%`}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAcceptOne(s.workPackageId, s.suggestedWeight)}
                      loading={updateWp.isPending}
                    >
                      {t('workPackage.proposed.accept')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {suggestions.length > 1 ? (
            <div className="border-t border-border pt-2">
              <Button variant="outline" size="sm" onClick={handleAcceptAll} loading={updateWp.isPending}>
                {t('workPackage.proposed.acceptAll')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {hasPackages ? (
        <PackageWeightsTable
          projectId={projectId}
          packages={data.packages}
          canEdit={canEdit}
          savePrimary={primary !== null}
          onDirtyChange={setWeightsDirty}
        />
      ) : null}

      <CreateWorkPackageDialog
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
        suggestedCode={nextCode}
        existingWeightPercent={existingWeightPercent}
      />

      <AllocateDialog
        projectId={projectId}
        packages={packages}
        open={allocating}
        onOpenChange={setAllocating}
      />
    </div>
  );
}

// ─── Dialogs ───────────────────────────────────────────────────────────────────────────────

function useDialogLabels() {
  const tCommon = useTranslations('common');
  const tDiscard = useTranslations('common.discardChanges');
  return {
    closeLabel: tCommon('close'),
    cancelLabel: tCommon('cancel'),
    discardLabels: {
      title: tDiscard('title'),
      description: tDiscard('description'),
      confirm: tDiscard('confirm'),
      cancel: tDiscard('cancel'),
    },
  };
}

/** "Add a package manually" — one package with a code, name, owner and weight. A `FormDialog` md. */
export function CreateWorkPackageDialog({
  projectId,
  open,
  onOpenChange,
  suggestedCode,
  existingWeightPercent,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestedCode: string;
  existingWeightPercent: number;
}) {
  // Mounted only while open, so every open starts from a clean form.
  return open ? (
    <CreateWorkPackageForm
      projectId={projectId}
      suggestedCode={suggestedCode}
      existingWeightPercent={existingWeightPercent}
      onClose={() => onOpenChange(false)}
    />
  ) : null;
}

function CreateWorkPackageForm({
  projectId,
  suggestedCode,
  existingWeightPercent,
  onClose,
}: {
  projectId: string;
  suggestedCode: string;
  existingWeightPercent: number;
  onClose: () => void;
}) {
  const t = useTranslations('progress');
  const labels = useDialogLabels();
  const create = useCreateWorkPackage(projectId);

  const [code, setCode] = useState(suggestedCode);
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [weight, setWeight] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeError = touched && !code.trim() ? t('workPackage.form.codeRequired') : undefined;
  const nameError = touched && !name.trim() ? t('workPackage.form.nameRequired') : undefined;
  const dirty = code !== suggestedCode || name !== '' || owner !== '' || weight !== '';

  // Live "how much of the 100% is still free" so weights are entered against a target, not guessed.
  const enteredWeightPercent = weight ? Math.round(Number(weight) * 100) : 0;
  const remainingPercent = Math.max(0, 100 - existingWeightPercent - enteredWeightPercent);
  const weightHint = `${t('workPackage.form.weightHint')} ${t('workPackage.form.weightRemaining', { remaining: remainingPercent })}`;

  function onSubmit() {
    setTouched(true);
    setError(null);
    if (!code.trim() || !name.trim()) return;

    create.mutate(
      {
        code: code.trim(),
        name: name.trim(),
        responsibleOwner: owner.trim() || undefined,
        progressWeight: weight ? Number(weight) : undefined,
      },
      {
        onSuccess: () => onClose(),
        onError: (e) => setError(e instanceof ApiError ? e.message : t('states.loadFailed')),
      },
    );
  }

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('actions.newWorkPackage')}
      size="md"
      dirty={dirty}
      busy={create.isPending}
      onSubmit={onSubmit}
      closeLabel={labels.closeLabel}
      discardLabels={labels.discardLabels}
    >
      <FormDialogBody>
        {error ? <Alert variant="error" messages={[error]} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor="wp-code" label={t('workPackage.form.code')} error={codeError}>
            <Input
              id="wp-code"
              value={code}
              placeholder={t('workPackage.form.codePlaceholder')}
              onChange={(e) => setCode(e.target.value)}
            />
          </FormField>
          <FormField htmlFor="wp-name" label={t('workPackage.form.name')} error={nameError}>
            <Input
              id="wp-name"
              value={name}
              placeholder={t('workPackage.form.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
          <FormField htmlFor="wp-owner" label={t('workPackage.form.responsibleOwner')}>
            <Input id="wp-owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
          </FormField>
          <FormField htmlFor="wp-weight" label={t('workPackage.form.progressWeight')} hint={weightHint}>
            <Input
              id="wp-weight"
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </FormField>
        </div>
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={create.isPending}>
            {labels.cancelLabel}
          </Button>
        </FormDialogClose>
        <Button type="submit" loading={create.isPending}>
          {t('workPackage.form.submit')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}

/** Allocate one BOQ item to a package. A `FormDialog` md. */
function AllocateDialog({
  projectId,
  packages,
  open,
  onOpenChange,
}: {
  projectId: string;
  packages: Array<{ id: string; code: string; name: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return open ? (
    <AllocateForm projectId={projectId} packages={packages} onClose={() => onOpenChange(false)} />
  ) : null;
}

function AllocateForm({
  projectId,
  packages,
  onClose,
}: {
  projectId: string;
  packages: Array<{ id: string; code: string; name: string }>;
  onClose: () => void;
}) {
  const t = useTranslations('progress');
  const labels = useDialogLabels();
  const { leaves, hasBaseline } = useBoqLeaves(projectId);

  const [workPackageId, setWorkPackageId] = useState('');
  const [boqNodeId, setBoqNodeId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const allocate = useAllocateBoqNode(projectId, workPackageId);

  function onSubmit() {
    setError(null);
    if (!workPackageId || !boqNodeId) return;
    allocate.mutate(boqNodeId, {
      onSuccess: () => onClose(),
      onError: (e) => setError(e instanceof ApiError ? e.message : t('states.loadFailed')),
    });
  }

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('workPackage.allocate.title')}
      size="md"
      dirty={workPackageId !== '' || boqNodeId !== ''}
      busy={allocate.isPending}
      onSubmit={hasBaseline ? onSubmit : undefined}
      closeLabel={labels.closeLabel}
      discardLabels={labels.discardLabels}
    >
      <FormDialogBody>
        {!hasBaseline ? (
          <p className="text-body text-muted-foreground">{t('workPackage.allocate.noBaseline')}</p>
        ) : (
          <>
            {error ? <Alert variant="error" messages={[error]} /> : null}
            <FormField htmlFor="alloc-wp" label={t('workPackage.allocate.workPackage')}>
              <Select id="alloc-wp" value={workPackageId} onChange={(value) => setWorkPackageId(value)}>
                <option value="">—</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField htmlFor="alloc-leaf" label={t('workPackage.allocate.boqNode')}>
              <Select id="alloc-leaf" value={boqNodeId} onChange={(value) => setBoqNodeId(value)}>
                <option value="">—</option>
                {leaves.map((leaf) => (
                  <option key={leaf.id} value={leaf.id}>
                    {lineLabel(leaf)}
                  </option>
                ))}
              </Select>
            </FormField>
          </>
        )}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={allocate.isPending}>
            {labels.cancelLabel}
          </Button>
        </FormDialogClose>
        {hasBaseline ? (
          <Button type="submit" disabled={!workPackageId || !boqNodeId} loading={allocate.isPending}>
            {t('workPackage.allocate.submit')}
          </Button>
        ) : null}
      </FormDialogFooter>
    </FormDialog>
  );
}
