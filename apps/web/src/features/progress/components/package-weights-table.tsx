'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ProjectRollupResponse, WorkPackageRollupLine } from '@erp/types';
import {
  Alert,
  Button,
  CheckboxField,
  cn,
  Input,
  Progress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  useToast,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { useUpdateWorkPackage } from '@/features/programme/hooks/use-programme';

import { getProjectRollup } from '../api/progress-api';
import {
  balanceTo100,
  currentUnits,
  percentTextOfUnits,
  unitsOfPercent,
  unitsOfWeight,
  weightOfUnits,
  WHOLE_UNITS,
  type WeightRow,
} from '../domain/package-weights';
import { progressKeys } from '../hooks/use-progress';

/** How long the total waits after the last keystroke before it is announced. */
const ANNOUNCE_DELAY_MS = 700;

/**
 * The work packages with their weights edited in place (ADR-039 §2).
 *
 * - Each measurable package has a percent input (two places, the stored precision). Stored weights
 *   are shown as they are; nothing the user did not touch is re-rounded or re-sent.
 * - A live total reads "Total 100%" (success) or "Total 85% — must be 100%" (attention). It is
 *   advisory: the server only reports completeness, so Save is allowed either way.
 * - "Balance to 100%" apportions the difference (largest remainder) across the edited rows, or
 *   across every row when the user opts in.
 * - Save PATCHes only the rows the user changed. Before it does, it refetches the roll-up: a row
 *   someone else changed since this user started editing it stops the save and says so. A row that
 *   fails keeps its draft, and the error names it, so Save retries just those.
 *
 * Only `manage:project` edits; everyone else reads the same table with plain percents.
 */
export function PackageWeightsTable({
  projectId,
  packages,
  canEdit,
  savePrimary = false,
  onDirtyChange,
}: {
  projectId: string;
  packages: WorkPackageRollupLine[];
  canEdit: boolean;
  /** The step is current, so its one primary is "Save weights" while there are edits. */
  savePrimary?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useTranslations('progress');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdateWorkPackage(projectId);

  // What the user typed, by package id: only rows they touched.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // The stored units of each touched row when the user started editing it — compared against a
  // fresh read before saving, so another manager's change is never silently overwritten.
  const [loadedUnits, setLoadedUnits] = useState<Record<string, number>>({});
  const [balanceAll, setBalanceAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const measurable = packages.filter((p) => !p.scheduleOnly);
  const rows: WeightRow[] = measurable.map((p) => ({
    id: p.id,
    storedUnits: unitsOfWeight(p.weight),
    draft: drafts[p.id],
  }));
  const codeOf = (id: string) => packages.find((p) => p.id === id)?.code ?? id;

  const invalid = new Set(rows.filter((r) => r.draft !== undefined && unitsOfPercent(r.draft) === null).map((r) => r.id));
  // Changed = typed, and different from what is stored.
  const changed = rows.filter((r) => r.draft !== undefined && unitsOfPercent(r.draft) !== r.storedUnits);
  const dirty = changed.length > 0;
  const totalUnits = rows.reduce((sum, r) => sum + currentUnits(r), 0);
  const exact = totalUnits === WHOLE_UNITS;
  const totalText = exact
    ? t('workPackage.weights.total', { total: percentTextOfUnits(totalUnits) })
    : t('workPackage.weights.totalOff', { total: percentTextOfUnits(totalUnits) });

  // Announced once typing stops, not per keystroke.
  const [announced, setAnnounced] = useState(totalText);
  useEffect(() => {
    const handle = window.setTimeout(() => setAnnounced(totalText), ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [totalText]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function setDraft(id: string, value: string) {
    setError(null);
    const stored = rows.find((r) => r.id === id)?.storedUnits ?? 0;
    setLoadedUnits((prev) => (id in prev ? prev : { ...prev, [id]: stored }));
    setDrafts((prev) => ({ ...prev, [id]: value }));
  }

  function undo() {
    setDrafts({});
    setLoadedUnits({});
    setError(null);
  }

  const balanced = canEdit ? balanceTo100(rows, balanceAll ? 'all' : 'edited') : null;
  function onBalance() {
    if (!balanced) return;
    for (const [id, value] of Object.entries(balanced)) setDraft(id, value);
  }

  async function onSave() {
    if (invalid.size > 0 || changed.length === 0) return;
    setError(null);
    setSaving(true);

    // 1. Has anyone else changed a row this user is about to save?
    let fresh: ProjectRollupResponse;
    try {
      fresh = await queryClient.fetchQuery({
        queryKey: progressKeys.rollup(projectId),
        queryFn: () => getProjectRollup(projectId),
        staleTime: 0,
      });
    } catch (e) {
      setSaving(false);
      setError(e instanceof ApiError ? e.message : t('workPackage.saveFailed'));
      return;
    }
    const conflicts = changed.flatMap((r) => {
      const line = fresh.packages.find((p) => p.id === r.id);
      const freshUnits = line ? unitsOfWeight(line.weight) : null;
      const loaded = loadedUnits[r.id] ?? r.storedUnits;
      return freshUnits !== null && freshUnits !== loaded ? [{ id: r.id, freshUnits }] : [];
    });
    if (conflicts.length > 0) {
      setSaving(false);
      // Their edit is now the starting point: a second Save after review goes through.
      setLoadedUnits((prev) => ({ ...prev, ...Object.fromEntries(conflicts.map((c) => [c.id, c.freshUnits])) }));
      setError(
        conflicts
          .map((c) =>
            t('workPackage.weights.conflict', { code: codeOf(c.id), now: percentTextOfUnits(c.freshUnits) }),
          )
          .join(' '),
      );
      return;
    }

    // 2. Save only what changed, one row at a time (the API has no batch weight save).
    const results = await Promise.allSettled(
      changed.map((r) =>
        update.mutateAsync({
          workPackageId: r.id,
          body: { progressWeight: weightOfUnits(unitsOfPercent(r.draft!) ?? 0) },
        }),
      ),
    );
    setSaving(false);
    const failed = changed.filter((_, index) => results[index]!.status === 'rejected');
    const saved = new Set(changed.filter((_, index) => results[index]!.status === 'fulfilled').map((r) => r.id));
    // Saved rows drop their draft and follow the server again; failed ones keep theirs for a retry.
    const keep = <T,>(record: Record<string, T>) =>
      Object.fromEntries(Object.entries(record).filter(([id]) => !saved.has(id)));
    setDrafts(keep);
    setLoadedUnits(keep);
    if (failed.length > 0) {
      const reason = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!.reason;
      setError(
        t('workPackage.weights.partialFailure', {
          codes: failed.map((r) => codeOf(r.id)).join(', '),
          message: reason instanceof ApiError ? reason.message : t('workPackage.saveFailed'),
        }),
      );
      return;
    }
    toast({ tone: 'success', title: t('workPackage.weights.saved') });
  }

  return (
    <div className="space-y-3">
      {error ? <Alert variant="error" messages={[error]} /> : null}
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
            {packages.map((p) => {
              const row = rows.find((r) => r.id === p.id);
              return (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap font-mono text-caption">{p.code}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground">{p.responsibleOwner ?? '—'}</TableCell>
                  <TableCell numeric className="whitespace-nowrap">
                    {!row ? (
                      // A schedule-only phase takes no part in the weighting.
                      <span className="text-muted-foreground">—</span>
                    ) : canEdit ? (
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max="100"
                        step="0.01"
                        value={row.draft ?? percentTextOfUnits(row.storedUnits)}
                        onChange={(e) => setDraft(p.id, e.target.value)}
                        disabled={saving}
                        aria-label={t('workPackage.weights.inputLabel', { code: p.code })}
                        aria-invalid={invalid.has(p.id) ? true : undefined}
                        endSlot={<span className="text-caption text-muted-foreground">%</span>}
                        className="ms-auto h-9 w-28 text-end tabular-nums"
                      />
                    ) : (
                      `${percentTextOfUnits(row.storedUnits)}%`
                    )}
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
              );
            })}
          </TableBody>
        </Table>
      </TableScroll>

      {measurable.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className={cn('text-body-sm font-medium tabular-nums', exact ? 'text-success' : 'text-warning')}>
              {totalText}
              {invalid.size > 0 ? (
                <span className="ms-2 font-normal text-danger">{t('workPackage.weights.invalid')}</span>
              ) : null}
            </p>
            <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {announced}
            </span>
            {canEdit && !exact ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  onClick={onBalance}
                  disabled={saving || balanced === null}
                >
                  {t('workPackage.weights.balance')}
                </Button>
                <CheckboxField
                  id="weights-balance-all"
                  label={t('workPackage.weights.balanceAll')}
                  checked={balanceAll}
                  onChange={(e) => setBalanceAll(e.target.checked)}
                />
              </div>
            ) : null}
          </div>
          {canEdit && dirty ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={undo} disabled={saving}>
                {t('workPackage.weights.undo')}
              </Button>
              <Button
                variant={savePrimary ? 'default' : 'outline'}
                size="sm"
                onClick={() => void onSave()}
                disabled={saving || invalid.size > 0}
              >
                {saving ? t('workPackage.weights.saving') : t('workPackage.weights.save')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
