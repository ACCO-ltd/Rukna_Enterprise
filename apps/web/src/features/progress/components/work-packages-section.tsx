'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormField,
  Input,
  Label,
  Select,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import { useAllocateBoqNode, useCreateWorkPackage, useProjectRollup } from '../hooks/use-progress';
import { lineLabel, useBoqLeaves } from '../hooks/use-boq-leaves';

/** Work-package control layer: create packages, allocate BOQ leaves, and see the weighted roll-up. */
export function WorkPackagesSection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const { data, isPending, isError, refetch, isFetching } = useProjectRollup(projectId);

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

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile label={t('rollup.physicalPercent')} value={`${data.physicalPercent}%`} />
        <StatTile
          label={t('rollup.weightsLabel')}
          value={`${Math.round(Number(data.weightsTotal) * 100)}%`}
          note={data.weightsComplete ? undefined : t('rollup.weightsIncomplete', { total: data.weightsTotal })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CreateWorkPackageForm projectId={projectId} />
        <AllocateForm
          projectId={projectId}
          packages={data.packages.map((p) => ({ id: p.id, code: p.code, name: p.name }))}
        />
      </div>

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
                <TableHead numeric>{t('workPackage.col.percent')}</TableHead>
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
                  <TableCell numeric className="whitespace-nowrap font-medium tabular-nums">
                    {`${p.percentComplete}%`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}
    </div>
  );
}

function CreateWorkPackageForm({ projectId }: { projectId: string }) {
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
        onSuccess: () => {
          setCode('');
          setName('');
          setOwner('');
          setWeight('');
          setTouched(false);
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : t('states.loadFailed')),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-panel border border-border bg-surface p-4" aria-label={t('actions.newWorkPackage')}>
      <h3 className="text-sm font-semibold text-foreground">{t('actions.newWorkPackage')}</h3>
      {error ? (
        <div className="mt-3">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
      <div className="mt-3">
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
}: {
  projectId: string;
  packages: Array<{ id: string; code: string; name: string }>;
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
      onSuccess: () => setBoqNodeId(''),
      onError: (e) => setError(e instanceof ApiError ? e.message : t('states.loadFailed')),
    });
  }

  const disabled = packages.length === 0 || !hasBaseline;

  return (
    <form onSubmit={onSubmit} className="rounded-panel border border-border bg-surface p-4" aria-label={t('workPackage.allocate.title')}>
      <h3 className="text-sm font-semibold text-foreground">{t('workPackage.allocate.title')}</h3>
      {!hasBaseline ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('workPackage.allocate.noBaseline')}</p>
      ) : null}
      {error ? (
        <div className="mt-3">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}
      <div className="mt-3 space-y-3">
        <div>
          <Label htmlFor="alloc-wp">{t('workPackage.allocate.workPackage')}</Label>
          <Select id="alloc-wp" value={workPackageId} onChange={(e) => setWorkPackageId(e.target.value)} disabled={disabled}>
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
          <Select id="alloc-leaf" value={boqNodeId} onChange={(e) => setBoqNodeId(e.target.value)} disabled={disabled}>
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
