'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormField,
  Input,
  Label,
  SectionHeader,
  Select,
  Dialog,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { MetricStrip } from '@/components/widget/metric-strip';
import { ApiError } from '@/lib/api-client';

import { useAllocateBoqNode, useCreateWorkPackage, useProjectRollup } from '../hooks/use-progress';
import { lineLabel, useBoqLeaves } from '../hooks/use-boq-leaves';

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

  const [creating, setCreating] = useState(false);
  const [allocating, setAllocating] = useState(false);

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-48 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

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

  return (
    <div className="space-y-5">
      <MetricStrip
        aria-label={t('rollup.title')}
        metrics={[
          { label: t('rollup.physicalPercent'), value: `${data.physicalPercent}%` },
          {
            label: t('rollup.weightsLabel'),
            value: `${Math.round(Number(data.weightsTotal) * 100)}%`,
            sublabel: data.weightsComplete
              ? t('rollup.weightsComplete')
              : t('rollup.weightsIncomplete', { total: data.weightsTotal }),
          },
        ]}
      />

      <div className="space-y-4">
        <SectionHeader title={t('workPackage.title')}>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAllocating(true)}
              disabled={data.packages.length === 0}
            >
              {t('actions.allocate')}
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              {t('actions.newWorkPackage')}
            </Button>
          </div>
        </SectionHeader>

        {data.packages.length === 0 ? (
          <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">{t('workPackage.emptyTitle')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('workPackage.emptyHint')}</p>
          </div>
        ) : (
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
                    <TableCell className="whitespace-nowrap font-mono text-xs">{p.code}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>
                      {p.responsibleOwner ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell numeric className="whitespace-nowrap tabular-nums">
                      {`${Math.round(Number(p.weight) * 100)}%`}
                    </TableCell>
                    <TableCell numeric className="tabular-nums">{p.leafCount}</TableCell>
                    <TableCell>
                      <PercentCompleteBar percent={p.percentComplete} label={t('workPackage.col.percent')} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="p-5 sm:p-6 sm:max-w-lg">
          <DialogTitle>{t('actions.newWorkPackage')}</DialogTitle>
          <div className="mt-5">
            <CreateWorkPackageForm projectId={projectId} onCreated={() => setCreating(false)} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={allocating} onOpenChange={setAllocating}>
        <DialogContent className="p-5 sm:p-6">
          <DialogTitle>{t('workPackage.allocate.title')}</DialogTitle>
          <div className="mt-5">
            <AllocateForm projectId={projectId} packages={packages} onAllocated={() => setAllocating(false)} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * A status-carrying progress bar (ux-doctrine §1): `warning` below 100%, `success` at 100% —
 * never the accent, which carries interactivity. The percentage reads alongside it for the exact
 * figure; the bar is the glanceable status.
 */
function PercentCompleteBar({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const complete = percent >= 100;
  return (
    <div className="flex items-center gap-2">
      <span
        className="block h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <span
          className={`block h-full rounded-full ${complete ? 'bg-success' : 'bg-warning'}`}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="whitespace-nowrap font-medium tabular-nums text-foreground">{`${percent}%`}</span>
    </div>
  );
}

function CreateWorkPackageForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const t = useTranslations('progress');
  const create = useCreateWorkPackage(projectId);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [weight, setWeight] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeError = touched && !code.trim() ? t('workPackage.form.codeRequired') : undefined;
  const nameError = touched && !name.trim() ? t('workPackage.form.nameRequired') : undefined;

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
        <FormField htmlFor="wp-weight" label={t('workPackage.form.progressWeight')} hint={t('workPackage.form.weightHint')}>
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

  const disabled = packages.length === 0 || !hasBaseline;

  return (
    <form onSubmit={onSubmit} aria-label={t('workPackage.allocate.title')}>
      {!hasBaseline ? (
        <p className="mb-3 text-sm text-muted-foreground">{t('workPackage.allocate.noBaseline')}</p>
      ) : null}
      {error ? (
        <div className="mb-3">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}
      <div className="space-y-3">
        <div>
          <Label htmlFor="alloc-wp">{t('workPackage.allocate.workPackage')}</Label>
          <Select id="alloc-wp" value={workPackageId} onChange={(value) => setWorkPackageId(value)} disabled={disabled}>
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
          <Select id="alloc-leaf" value={boqNodeId} onChange={(value) => setBoqNodeId(value)} disabled={disabled}>
            <option value="">—</option>
            {leaves.map((leaf) => (
              <option key={leaf.id} value={leaf.id}>
                {lineLabel(leaf)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={disabled || allocate.isPending || !workPackageId || !boqNodeId}>
          {t('workPackage.allocate.submit')}
        </Button>
      </div>
    </form>
  );
}
