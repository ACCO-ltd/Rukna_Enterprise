'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, FormField, Input, Label, Select, Dialog, DialogContent, DialogHeader, DialogTitle } from '@erp/ui';
import { Layers } from 'lucide-react';

import type { SuggestedWeightLine } from '@erp/types';

import { ApiError } from '@/lib/api-client';

import { useSuggestWeights, useUpdateWorkPackage } from '@/features/programme/hooks/use-programme';
import { useBoqWorkspace } from '@/features/boq/hooks/use-boq';
import { useAllocateBoqNode, useCreateWorkPackage, useProjectRollup } from '../hooks/use-progress';
import { lineLabel, useBoqLeaves } from '../hooks/use-boq-leaves';
import { DeliveryPlanDialog } from './delivery-plan-dialog';
import {
  RefBar,
  RefButton,
  RefCard,
  RefCardBody,
  RefCardHeader,
  RefEmpty,
  RefStatTile,
  RefTable,
  RefTableScroll,
  RefTbody,
  RefTd,
  RefTh,
  RefThead,
  RefTr,
} from './ref-ui';

const refFieldClass = 'rounded-control border-border focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary';

/**
 * Work-package control layer: an index that leads with the weighted roll-up and the packages
 * table. The two forms (create a package, allocate a BOQ leaf) used to sit always-on above the
 * table; they now live behind primaries (`+ New work package`, `Allocate item`) in `Dialog`s, so
 * the view opens on the data — the project figure and the packages behind it — not two forms.
 */
export function WorkPackagesSection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const { data, isPending, isError, refetch, isFetching } = useProjectRollup(projectId);
  const { hasBaseline } = useBoqLeaves(projectId);
  const workspace = useBoqWorkspace(projectId);

  const [creating, setCreating] = useState(false);
  const [allocating, setAllocating] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedWeightLine[] | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const suggest = useSuggestWeights(projectId);
  const updateWp = useUpdateWorkPackage(projectId);

  function handleSuggest() {
    setSuggestError(null);
    suggest.mutate(undefined, {
      onSuccess: (res) => setSuggestions(res.weights),
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
    for (const w of suggestions) {
      updateWp.mutate(
        { workPackageId: w.workPackageId, body: { progressWeight: Number(w.suggestedWeight.toFixed(4)) } },
        {
          onError: (e) =>
            setSuggestError(e instanceof ApiError ? e.message : t('workPackage.saveFailed')),
        },
      );
    }
    setSuggestions(null);
  }

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-48 animate-pulse rounded-container bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="error" messages={[t('states.loadFailed')]}>
        <div className="mt-3">
          <RefButton variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            {t('actions.retry')}
          </RefButton>
        </div>
      </Alert>
    );
  }

  const packages = data.packages.map((p) => ({ id: p.id, code: p.code, name: p.name }));
  // Reduce blank-guessing: suggest the next sequential code, and show how much weight is still free.
  const nextCode = `WP-${String(data.packages.length + 1).padStart(2, '0')}`;
  const existingWeightPercent = Math.round(Number(data.weightsTotal) * 100);

  return (
    <RefCard>
      <RefCardHeader
        icon={<Layers size={17} strokeWidth={1.9} />}
        title={t('workPackage.title')}
        subtitle={t('workPackage.subtitle')}
        divider
        action={
          <>
            <RefButton
              variant="ghost"
              size="sm"
              onClick={handleSuggest}
              disabled={suggest.isPending || data.packages.length === 0}
            >
              {t('workPackage.suggestWeights')}
            </RefButton>
            <RefButton
              variant="outline"
              size="sm"
              onClick={() => setAllocating(true)}
              disabled={data.packages.length === 0}
            >
              {t('actions.allocate')}
            </RefButton>
            <RefButton
              variant="outline"
              size="sm"
              onClick={() => setPlanning(true)}
              disabled={!hasBaseline}
              title={!hasBaseline ? t('deliveryPlan.noBaseline') : undefined}
            >
              {t('deliveryPlan.action')}
            </RefButton>
            <RefButton size="sm" onClick={() => setCreating(true)}>
              {t('actions.newWorkPackage')}
            </RefButton>
          </>
        }
      />
      <RefCardBody className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-4 rounded-panel border border-border p-4 sm:w-fit sm:grid-cols-2">
          <RefStatTile label={t('rollup.physicalPercent')} value={`${data.physicalPercent}%`} />
          <RefStatTile
            label={t('rollup.weightsLabel')}
            value={`${Math.round(Number(data.weightsTotal) * 100)}%`}
            tone={data.weightsComplete ? 'green' : 'amber'}
          />
        </div>

        {suggestError ? (
          <Alert variant="error" messages={[suggestError]}>
            <div className="mt-2">
              <RefButton variant="ghost" size="sm" onClick={() => setSuggestError(null)}>
                {t('actions.cancel')}
              </RefButton>
            </div>
          </Alert>
        ) : null}

        {suggestions !== null ? (
          <div className="rounded-panel border border-border bg-surface-subtle p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-body font-medium text-foreground">{t('workPackage.proposed.title')}</p>
                <p className="mt-0.5 text-caption text-muted-foreground">{t('workPackage.proposed.hint')}</p>
              </div>
              <RefButton variant="ghost" size="sm" onClick={() => setSuggestions(null)}>
                {t('workPackage.proposed.dismiss')}
              </RefButton>
            </div>
            <div className="space-y-1">
              {suggestions.map((s) => {
                const pkg = data.packages.find((p) => p.id === s.workPackageId);
                const proposedPercent = Math.round(s.suggestedWeight * 100);
                return (
                  <div key={s.workPackageId} className="flex items-center justify-between gap-4 py-1.5">
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <span className="shrink-0 font-mono text-caption text-muted-foreground">
                        {pkg?.code ?? s.workPackageId}
                      </span>
                      <span className="truncate text-body text-foreground">{pkg?.name ?? s.workPackageId}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="w-10 text-right tabular-nums text-body font-medium text-foreground">
                        {`${proposedPercent}%`}
                      </span>
                      <RefButton
                        variant="outline"
                        size="sm"
                        onClick={() => handleAcceptOne(s.workPackageId, s.suggestedWeight)}
                        disabled={updateWp.isPending}
                      >
                        {t('workPackage.proposed.accept')}
                      </RefButton>
                    </div>
                  </div>
                );
              })}
            </div>
            {suggestions.length > 1 ? (
              <div className="border-t border-border pt-2">
                <RefButton size="sm" onClick={handleAcceptAll} disabled={updateWp.isPending}>
                  {t('workPackage.proposed.acceptAll')}
                </RefButton>
              </div>
            ) : null}
          </div>
        ) : null}

        {data.packages.length === 0 ? (
          <RefEmpty
            title={t('workPackage.emptyTitle')}
            hint={hasBaseline ? t('workPackage.emptyHint') : t('deliveryPlan.noBaseline')}
            action={
              hasBaseline ? (
                <RefButton onClick={() => setPlanning(true)}>{t('deliveryPlan.action')}</RefButton>
              ) : undefined
            }
          />
        ) : (
          <RefTableScroll aria-label={t('workPackage.title')}>
            <RefTable>
              <RefThead>
                <RefTr>
                  <RefTh>{t('workPackage.col.code')}</RefTh>
                  <RefTh>{t('workPackage.col.name')}</RefTh>
                  <RefTh>{t('workPackage.col.owner')}</RefTh>
                  <RefTh numeric>{t('workPackage.col.weight')}</RefTh>
                  <RefTh numeric>{t('workPackage.col.items')}</RefTh>
                  <RefTh>{t('workPackage.col.percent')}</RefTh>
                </RefTr>
              </RefThead>
              <RefTbody>
                {data.packages.map((p) => (
                  <RefTr key={p.id}>
                    <RefTd className="whitespace-nowrap font-mono text-xs">{p.code}</RefTd>
                    <RefTd className="font-medium">{p.name}</RefTd>
                    <RefTd>
                      {p.responsibleOwner ?? <span className="text-disabled-foreground">—</span>}
                    </RefTd>
                    <RefTd numeric className="whitespace-nowrap tabular-nums">
                      {`${Math.round(Number(p.weight) * 100)}%`}
                    </RefTd>
                    <RefTd numeric className="tabular-nums">{p.leafCount}</RefTd>
                    <RefTd>
                      {/* Schedule-only phases have no derived % — dash, not a misleading 0%. */}
                      {p.percentComplete === null ? (
                        <span className="text-disabled-foreground">—</span>
                      ) : (
                        <RefBar percent={p.percentComplete} tone={p.percentComplete >= 100 ? 'green' : 'blue'} />
                      )}
                    </RefTd>
                  </RefTr>
                ))}
              </RefTbody>
            </RefTable>
          </RefTableScroll>
        )}
      </RefCardBody>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t('actions.newWorkPackage')}</DialogTitle>
          </DialogHeader>
          <CreateWorkPackageForm
            projectId={projectId}
            suggestedCode={nextCode}
            existingWeightPercent={existingWeightPercent}
            onCreated={() => setCreating(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={allocating} onOpenChange={setAllocating}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t('workPackage.allocate.title')}</DialogTitle>
          </DialogHeader>
          <AllocateForm projectId={projectId} packages={packages} onAllocated={() => setAllocating(false)} />
        </DialogContent>
      </Dialog>

      <DeliveryPlanDialog
        projectId={projectId}
        currency={workspace.data?.currency ?? null}
        open={planning}
        onOpenChange={setPlanning}
      />
    </RefCard>
  );
}

function CreateWorkPackageForm({
  projectId,
  suggestedCode,
  existingWeightPercent,
  onCreated,
}: {
  projectId: string;
  suggestedCode: string;
  existingWeightPercent: number;
  onCreated: () => void;
}) {
  const t = useTranslations('progress');
  const create = useCreateWorkPackage(projectId);

  const [code, setCode] = useState(suggestedCode);
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [weight, setWeight] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeError = touched && !code.trim() ? t('workPackage.form.codeRequired') : undefined;
  const nameError = touched && !name.trim() ? t('workPackage.form.nameRequired') : undefined;

  // Live "how much of the 100% is still free" so weights are entered against a target, not guessed.
  const enteredWeightPercent = weight ? Math.round(Number(weight) * 100) : 0;
  const remainingPercent = Math.max(0, 100 - existingWeightPercent - enteredWeightPercent);
  const weightHint = `${t('workPackage.form.weightHint')} ${t('workPackage.form.weightRemaining', { remaining: remainingPercent })}`;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
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
        onSuccess: () => onCreated(),
        onError: (e) => setError(e instanceof ApiError ? e.message : t('states.loadFailed')),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} aria-label={t('actions.newWorkPackage')}>
      {error ? (
        <div className="mb-3">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField htmlFor="wp-code" label={t('workPackage.form.code')} error={codeError}>
          <Input id="wp-code" value={code} placeholder={t('workPackage.form.codePlaceholder')} onChange={(e) => setCode(e.target.value)} className={refFieldClass} />
        </FormField>
        <FormField htmlFor="wp-name" label={t('workPackage.form.name')} error={nameError}>
          <Input id="wp-name" value={name} placeholder={t('workPackage.form.namePlaceholder')} onChange={(e) => setName(e.target.value)} className={refFieldClass} />
        </FormField>
        <FormField htmlFor="wp-owner" label={t('workPackage.form.responsibleOwner')}>
          <Input id="wp-owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={refFieldClass} />
        </FormField>
        <FormField htmlFor="wp-weight" label={t('workPackage.form.progressWeight')} hint={weightHint}>
          <Input id="wp-weight" type="number" min="0" max="1" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} className={refFieldClass} />
        </FormField>
      </div>
      <div className="mt-4">
        <RefButton type="submit" disabled={create.isPending}>
          {t('workPackage.form.submit')}
        </RefButton>
      </div>
    </form>
  );
}

function AllocateForm({
  projectId,
  packages,
  onAllocated,
}: {
  projectId: string;
  packages: Array<{ id: string; code: string; name: string }>;
  onAllocated: () => void;
}) {
  const t = useTranslations('progress');
  const { leaves, hasBaseline } = useBoqLeaves(projectId);

  const [workPackageId, setWorkPackageId] = useState('');
  const [boqNodeId, setBoqNodeId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const allocate = useAllocateBoqNode(projectId, workPackageId);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!workPackageId || !boqNodeId) return;
    allocate.mutate(boqNodeId, {
      onSuccess: () => {
        setBoqNodeId('');
        onAllocated();
      },
      onError: (e) => setError(e instanceof ApiError ? e.message : t('states.loadFailed')),
    });
  }

  const disabled = packages.length === 0 || !hasBaseline;

  return (
    <form onSubmit={onSubmit} aria-label={t('workPackage.allocate.title')}>
      {!hasBaseline ? (
        <p className="mb-3 text-body text-muted-foreground">{t('workPackage.allocate.noBaseline')}</p>
      ) : null}
      {error ? (
        <div className="mb-3">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}
      <div className="space-y-3">
        <div>
          <Label htmlFor="alloc-wp">{t('workPackage.allocate.workPackage')}</Label>
          <Select id="alloc-wp" value={workPackageId} onChange={(value) => setWorkPackageId(value)} disabled={disabled} className={refFieldClass}>
            <option value="">—</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="alloc-leaf">{t('workPackage.allocate.boqNode')}</Label>
          <Select id="alloc-leaf" value={boqNodeId} onChange={(value) => setBoqNodeId(value)} disabled={disabled} className={refFieldClass}>
            <option value="">—</option>
            {leaves.map((leaf) => (
              <option key={leaf.id} value={leaf.id}>
                {lineLabel(leaf)}
              </option>
            ))}
          </Select>
        </div>
        <RefButton type="submit" disabled={disabled || allocate.isPending || !workPackageId || !boqNodeId}>
          {t('workPackage.allocate.submit')}
        </RefButton>
      </div>
    </form>
  );
}
