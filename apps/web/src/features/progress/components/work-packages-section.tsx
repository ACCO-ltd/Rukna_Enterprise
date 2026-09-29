'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Label,
  Progress,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import type { SuggestedWeightLine } from '@erp/types';

import { ApiError } from '@/lib/api-client';

import { useSuggestWeights, useUpdateWorkPackage } from '@/features/programme/hooks/use-programme';
import { useAllocateBoqNode, useCreateWorkPackage, useProjectRollup } from '../hooks/use-progress';
import { lineLabel, useBoqLeaves } from '../hooks/use-boq-leaves';

/** Which of the editor's actions is the screen's one primary right now, if any. */
export type WorkPackageEditorPrimary = 'allocate' | 'weights' | null;

/**
 * The work-package editor, embedded in Plan & setup's "Work packages" step: the packages with
 * their weights and allocated BOQ items, plus the three editing actions (suggest weights from BOQ
 * values, allocate an item, add a package). The step decides which action is the primary — the
 * one that closes the current gap — and the rest render as secondary, so the screen never shows
 * two primaries.
 */
export function WorkPackageEditor({
  projectId,
  primary,
}: {
  projectId: string;
  primary: WorkPackageEditorPrimary;
}) {
  const t = useTranslations('progress');
  const { data, isPending, isError, refetch, isFetching } = useProjectRollup(projectId);

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
  const hasPackages = data.packages.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {hasPackages ? (
          <Button
            variant={primary === 'allocate' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAllocating(true)}
          >
            {t('actions.allocate')}
          </Button>
        ) : null}
        {hasPackages ? (
          <Button
            variant={primary === 'weights' ? 'default' : 'outline'}
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
            {suggestions.map((s) => {
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
                      {`${Math.round(s.suggestedWeight * 100)}%`}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAcceptOne(s.workPackageId, s.suggestedWeight)}
                      disabled={updateWp.isPending}
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
              <Button variant="outline" size="sm" onClick={handleAcceptAll} disabled={updateWp.isPending}>
                {t('workPackage.proposed.acceptAll')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {hasPackages ? (
        <TableScroll aria-label={t('workPackage.title')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('workPackage.col.code')}</TableHead>
                <TableHead>{t('workPackage.col.name')}</TableHead>
                <TableHead>{t('workPackage.col.owner')}</TableHead>
                <TableHead numeric>{t('workPackage.col.weight')}</TableHead>
                <TableHead numeric>{t('workPackage.col.items')}</TableHead>
                <TableHead>{t('workPackage.col.percent')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.packages.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap font-mono text-caption">{p.code}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground">{p.responsibleOwner ?? '—'}</TableCell>
                  <TableCell numeric className="whitespace-nowrap">
                    {`${Math.round(Number(p.weight) * 100)}%`}
                  </TableCell>
                  <TableCell numeric className={p.leafCount === 0 && !p.scheduleOnly ? 'text-warning' : undefined}>
                    {p.leafCount}
                  </TableCell>
                  <TableCell className="min-w-28">
                    {/* Schedule-only phases have no derived % — dash, not a misleading 0%. */}
                    {p.percentComplete === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Progress
                          value={p.percentComplete}
                          size="sm"
                          tone={p.percentComplete >= 100 ? 'success' : 'default'}
                          label={`${p.code} ${p.percentComplete}%`}
                        />
                        <span className="w-9 shrink-0 text-end text-caption tabular-nums text-muted-foreground">
                          {`${p.percentComplete}%`}
                        </span>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      ) : null}

      <CreateWorkPackageDialog
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
        suggestedCode={nextCode}
        existingWeightPercent={existingWeightPercent}
      />

      <Dialog open={allocating} onOpenChange={setAllocating}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t('workPackage.allocate.title')}</DialogTitle>
          </DialogHeader>
          <AllocateForm projectId={projectId} packages={packages} onAllocated={() => setAllocating(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "Add a package manually" — one package with a code, name, owner and weight. */
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
  const t = useTranslations('progress');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('actions.newWorkPackage')}</DialogTitle>
        </DialogHeader>
        {open ? (
          <CreateWorkPackageForm
            projectId={projectId}
            suggestedCode={suggestedCode}
            existingWeightPercent={existingWeightPercent}
            onCreated={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
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
          <Input id="wp-code" value={code} placeholder={t('workPackage.form.codePlaceholder')} onChange={(e) => setCode(e.target.value)} />
        </FormField>
        <FormField htmlFor="wp-name" label={t('workPackage.form.name')} error={nameError}>
          <Input id="wp-name" value={name} placeholder={t('workPackage.form.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField htmlFor="wp-owner" label={t('workPackage.form.responsibleOwner')}>
          <Input id="wp-owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
        </FormField>
        <FormField htmlFor="wp-weight" label={t('workPackage.form.progressWeight')} hint={weightHint}>
          <Input id="wp-weight" type="number" min="0" max="1" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </FormField>
      </div>
      <div className="mt-4">
        <Button type="submit" disabled={create.isPending}>
          {t('workPackage.form.submit')}
        </Button>
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

  if (!hasBaseline) {
    return <p className="text-body text-muted-foreground">{t('workPackage.allocate.noBaseline')}</p>;
  }

  return (
    <form onSubmit={onSubmit} aria-label={t('workPackage.allocate.title')}>
      {error ? (
        <div className="mb-3">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}
      <div className="space-y-3">
        <div>
          <Label htmlFor="alloc-wp">{t('workPackage.allocate.workPackage')}</Label>
          <Select id="alloc-wp" value={workPackageId} onChange={(value) => setWorkPackageId(value)}>
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
          <Select id="alloc-leaf" value={boqNodeId} onChange={(value) => setBoqNodeId(value)}>
            <option value="">—</option>
            {leaves.map((leaf) => (
              <option key={leaf.id} value={leaf.id}>
                {lineLabel(leaf)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={allocate.isPending || !workPackageId || !boqNodeId}>
          {t('workPackage.allocate.submit')}
        </Button>
      </div>
    </form>
  );
}
