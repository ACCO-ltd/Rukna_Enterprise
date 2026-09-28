'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { ProgressMeasurementResponse } from '@erp/types';
import {
  Alert,
  Button,
  Input,
  Label,
  Notice,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Textarea,
  useToast,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatDate, formatNumber } from '@/lib/format';

import { isEditableDpr } from '../domain/my-reports';
import { mapDprError, type DprQuantityFieldError } from '../domain/dpr-errors';
import type { DailyProgressReportDetail } from '../api/progress-api';
import {
  useAddMeasurement,
  useDpr,
  usePatchDprContext,
  progressKeys,
  useProjectProgress,
  useRemoveMeasurement,
  useSubmitDpr,
  useWorkPackages,
} from '../hooks/use-progress';
import { lineLabel, useBoqLeaves, type ClaimableLine } from '../hooks/use-boq-leaves';
import { DprDetail, DprEvidence, LabourSection } from './dpr-detail';

/**
 * The daily report, opened from Today in a side sheet.
 *
 * An editable report (draft, returned, reopened) shows the entry form: every BOQ item grouped by
 * work package with a quantity input and its to-date figure, then labour and hours, site notes and
 * photos. Each entry saves as it is made (the API has no batch save); "Save draft" and "Submit for
 * review" first flush and await any site notes not yet saved, and stay open if that fails. A report that is no longer editable opens
 * read-only in the same sheet.
 *
 * Work packages are not linked to users (`responsibleOwner` is free text), so the form shows ALL
 * items grouped by package rather than "my" packages (owner-approved).
 */
export function DprEntrySheet({
  projectId,
  dprId,
  onClose,
}: {
  projectId: string;
  /** The report to open; `null` closes the sheet. */
  dprId: string | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={dprId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent size="xl">
        {/* Keyed by report: opening another report starts from its own state, never the last one's. */}
        {dprId ? <SheetInner key={dprId} projectId={projectId} dprId={dprId} onClose={onClose} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function SheetInner({ projectId, dprId, onClose }: { projectId: string; dprId: string; onClose: () => void }) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const dpr = useDpr(dprId);

  const title = dpr.data
    ? t('entry.title', { date: formatDate(dpr.data.reportDate, locale) ?? dpr.data.reportDate })
    : t('report.title');

  if (dpr.isPending || dpr.isError) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {dpr.isPending ? (
            <Skeleton className="h-48 w-full rounded-panel" aria-hidden="true" />
          ) : (
            <Alert variant="error" messages={[t('states.loadFailed')]} />
          )}
        </SheetBody>
      </>
    );
  }

  if (!isEditableDpr(dpr.data.status)) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <DprDetail projectId={projectId} dprId={dprId} onBack={onClose} />
        </SheetBody>
      </>
    );
  }

  return <EntryForm projectId={projectId} dpr={dpr.data} title={title} onClose={onClose} />;
}

interface ItemGroup {
  key: string;
  label: string;
  items: ClaimableLine[];
}

function EntryForm({
  projectId,
  dpr,
  title,
  onClose,
}: {
  projectId: string;
  dpr: DailyProgressReportDetail;
  title: string;
  onClose: () => void;
}) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const { toast } = useToast();

  const { leaves, isPending: leavesPending } = useBoqLeaves(projectId);
  const workPackages = useWorkPackages(projectId);
  const progress = useProjectProgress(projectId);
  const submit = useSubmitDpr(projectId, dpr.id);
  const patch = usePatchDprContext(dpr.id);
  const queryClient = useQueryClient();

  const [fieldErrors, setFieldErrors] = useState<Record<string, DprQuantityFieldError>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notes, setNotes] = useState(dpr.narrative ?? '');
  const [notesError, setNotesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped when a submit comes back with item errors, so focus moves to the first one.
  const [focusRequest, setFocusRequest] = useState(0);

  const leafLabel = useMemo(() => new Map(leaves.map((l) => [l.id, lineLabel(l)])), [leaves]);

  // All items, grouped by the work package they are allocated to, in package order; anything
  // allocated nowhere goes last under its own heading so nothing measurable is hidden.
  const groups = useMemo<ItemGroup[]>(() => {
    const byId = new Map(leaves.map((l) => [l.id, l]));
    const placed = new Set<string>();
    const out: ItemGroup[] = [];
    for (const wp of workPackages.data ?? []) {
      const items = (wp.boqNodeIds ?? [])
        .map((id) => byId.get(id))
        .filter((l): l is ClaimableLine => Boolean(l));
      items.forEach((l) => placed.add(l.id));
      if (items.length > 0) out.push({ key: wp.id, label: `${wp.code} ${wp.name}`, items });
    }
    const rest = leaves.filter((l) => !placed.has(l.id));
    if (rest.length > 0 && out.length > 0) out.push({ key: 'unassigned', label: t('entry.unassigned'), items: rest });
    return out;
  }, [leaves, workPackages.data, t]);

  const verifiedByNode = useMemo(
    () => new Map((progress.data ?? []).map((line) => [line.boqNodeId, line])),
    [progress.data],
  );
  const measurementsByNode = useMemo(() => {
    const map = new Map<string, ProgressMeasurementResponse[]>();
    for (const m of dpr.measurements) map.set(m.boqNodeId, [...(map.get(m.boqNodeId) ?? []), m]);
    return map;
  }, [dpr.measurements]);

  // Move focus to the first errored item (in screen order) once it has rendered.
  useEffect(() => {
    if (focusRequest === 0) return;
    for (const group of groups) {
      const first = group.items.find((leaf) => fieldErrors[leaf.id]);
      if (first) {
        document.getElementById(`entry-qty-${first.id}`)?.focus();
        return;
      }
    }
  }, [focusRequest, groups, fieldErrors]);

  /** A 409 (DPR_CHANGED, or the server busy) means what is on screen is stale: reload it. */
  function refetchReport() {
    void queryClient.invalidateQueries({ queryKey: progressKeys.report(dpr.id) });
    void queryClient.invalidateQueries({ queryKey: progressKeys.reports(projectId) });
  }

  /** "1 item exceeds its BOQ quantity: 2.2 RC C30 slab — enter 2 or less". */
  function describeExceeds(errors: Record<string, DprQuantityFieldError>): string {
    const lines = Object.entries(errors).map(([id, e]) =>
      t('entry.exceedsSummaryLine', {
        item: leafLabel.get(id) ?? id,
        max: `${formatNumber(e.max, locale, 3) ?? e.max}${e.unit ? ` ${e.unit}` : ''}`,
      }),
    );
    return t('entry.exceedsSummary', { count: lines.length, list: lines.join('; ') });
  }

  /**
   * Saves site notes that have not been saved yet and waits for the answer. Returns false when the
   * save failed — the caller then keeps the sheet open so nothing typed is lost.
   */
  async function flushNotes(): Promise<boolean> {
    const next = notes.trim();
    if (next === (dpr.narrative ?? '').trim()) return true;
    setNotesError(null);
    try {
      await patch.mutateAsync({ narrative: next || undefined });
      return true;
    } catch (error) {
      setNotesError(t('entry.notesFailed', { message: mapDprError(error, t('entry.saveFailed')).formError }));
      return false;
    }
  }

  async function onSaveDraft() {
    setBusy(true);
    const saved = await flushNotes();
    setBusy(false);
    if (saved) onClose();
  }

  async function onSubmit() {
    setFormError(null);
    setFieldErrors({});
    setBusy(true);
    const saved = await flushNotes();
    if (!saved) {
      setBusy(false);
      return;
    }
    submit.mutate(undefined, {
      onSuccess: () => {
        setBusy(false);
        toast({ tone: 'success', title: t('entry.submitted') });
        onClose();
      },
      onError: (error) => {
        setBusy(false);
        const mapped = mapDprError(error, t('entry.saveFailed'), describeExceeds);
        setFieldErrors(mapped.fieldErrors);
        setFormError(mapped.formError);
        // 409: the report changed under us (someone else acted on it). Say so plainly and reload
        // it, so what the sheet shows is the current report.
        if (error instanceof ApiError && error.status === 409) refetchReport();
        if (Object.keys(mapped.fieldErrors).length > 0) setFocusRequest((n) => n + 1);
      },
    });
  }

  const loading = leavesPending || workPackages.isPending;

  return (
    <>
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{t('entry.description')}</SheetDescription>
      </SheetHeader>

      <SheetBody className="space-y-8">
        {dpr.status === 'RETURNED' && dpr.returnReason ? (
          <Notice tone="attention">{t('entry.returned', { reason: dpr.returnReason })}</Notice>
        ) : null}

        {formError ? <Alert variant="error" messages={[formError]} /> : null}

        <section aria-labelledby="entry-work" className="space-y-4">
          <div>
            <h3 id="entry-work" className="text-body font-semibold text-foreground">
              {t('entry.workDone')}
            </h3>
            <p className="text-body-sm text-muted-foreground">{t('entry.workDoneHint')}</p>
            {dpr.status === 'REOPENED' ? (
              <p className="mt-1 text-body-sm text-foreground">{t('entry.reopenedNote')}</p>
            ) : null}
          </div>

          {loading ? (
            <Skeleton className="h-32 w-full rounded-panel" aria-hidden="true" />
          ) : groups.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">{t('entry.noItems')}</p>
          ) : (
            groups.map((group) => (
              <div key={group.key} className="space-y-2">
                <h4 className="text-caption font-semibold uppercase text-muted-foreground">{group.label}</h4>
                <ul className="divide-y divide-border rounded-panel border border-border">
                  {group.items.map((leaf) => (
                    <EntryItemRow
                      key={leaf.id}
                      projectId={projectId}
                      dprId={dpr.id}
                      leaf={leaf}
                      verifiedToDate={Number(verifiedByNode.get(leaf.id)?.verifiedToDate ?? 0)}
                      scope={verifiedByNode.get(leaf.id)?.measurableQuantity ?? leaf.quantity}
                      measurements={measurementsByNode.get(leaf.id) ?? []}
                      // A reopened report keeps its approved entries: the server refuses (409) to
                      // delete one made before the reopen, and the response does not say which
                      // entries came after it — so none offers Remove on a reopened report.
                      canRemove={dpr.status !== 'REOPENED'}
                      onConflict={refetchReport}
                      fieldError={fieldErrors[leaf.id]}
                      rowError={rowErrors[leaf.id]}
                      onRowError={(message) =>
                        setRowErrors((prev) => {
                          const next = { ...prev };
                          if (message) next[leaf.id] = message;
                          else delete next[leaf.id];
                          return next;
                        })
                      }
                      onFieldError={(error) =>
                        setFieldErrors((prev) => {
                          const next = { ...prev };
                          if (error) next[leaf.id] = error;
                          else delete next[leaf.id];
                          return next;
                        })
                      }
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <section aria-labelledby="entry-labour" className="space-y-3">
          <h3 id="entry-labour" className="text-body font-semibold text-foreground">
            {t('entry.labour')}
          </h3>
          <LabourSection dprId={dpr.id} rows={dpr.labourRows ?? []} editable />
        </section>

        <section aria-labelledby="entry-notes" className="space-y-2">
          <h3 id="entry-notes" className="text-body font-semibold text-foreground">
            <label htmlFor="entry-notes-field">{t('entry.notes')}</label>
          </h3>
          <Textarea
            id="entry-notes-field"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => void flushNotes()}
            aria-describedby="entry-notes-hint"
            aria-invalid={notesError ? true : undefined}
          />
          <p id="entry-notes-hint" className="text-caption text-muted-foreground">
            {t('entry.notesHint')}
          </p>
          {notesError ? (
            <p role="alert" className="text-caption font-medium text-danger">
              {notesError}
            </p>
          ) : null}
        </section>

        <section aria-labelledby="entry-photos" className="space-y-3">
          <h3 id="entry-photos" className="text-body font-semibold text-foreground">
            {t('entry.photos')}
          </h3>
          <DprEvidence
            dprId={dpr.id}
            canUpload
            attachments={dpr.attachments}
            measurements={dpr.measurements}
            leafLabel={leafLabel}
            bare
          />
        </section>
      </SheetBody>

      {/* SheetFooter lays out row-reverse from `sm`: the primary comes first so it sits at the end. */}
      <SheetFooter>
        <Button onClick={() => void onSubmit()} disabled={busy || submit.isPending}>
          {t('entry.submit')}
        </Button>
        <Button variant="outline" onClick={() => void onSaveDraft()} disabled={busy}>
          {t('entry.saveDraft')}
        </Button>
      </SheetFooter>
    </>
  );
}

function EntryItemRow({
  projectId,
  dprId,
  leaf,
  verifiedToDate,
  scope,
  measurements,
  canRemove,
  onConflict,
  fieldError,
  rowError,
  onRowError,
  onFieldError,
}: {
  projectId: string;
  dprId: string;
  leaf: ClaimableLine;
  verifiedToDate: number;
  scope: string | null;
  measurements: ProgressMeasurementResponse[];
  canRemove: boolean;
  onConflict: () => void;
  fieldError: DprQuantityFieldError | undefined;
  rowError: string | undefined;
  onRowError: (message: string | null) => void;
  onFieldError: (error: DprQuantityFieldError | null) => void;
}) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const add = useAddMeasurement(dprId);
  const remove = useRemoveMeasurement(projectId, dprId);
  const [quantity, setQuantity] = useState('');

  const unit = leaf.unit ?? '';
  const withUnit = (n: number | string) => `${formatNumber(n, locale, 3) ?? n}${unit ? ` ${unit}` : ''}`;
  const recordedHere = measurements.reduce((sum, m) => sum + Number(m.quantity), 0);
  const cumulative = verifiedToDate + recordedHere;
  const scopeNum = scope != null && scope !== '' ? Number(scope) : null;
  const hint =
    scopeNum != null && Number.isFinite(scopeNum)
      ? t('entry.toDate', { cumulative: withUnit(cumulative), total: withUnit(scopeNum) })
      : t('entry.toDateNoScope', { cumulative: withUnit(cumulative) });

  const inputId = `entry-qty-${leaf.id}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const maxText = fieldError
    ? `${formatNumber(fieldError.max, locale, 3) ?? fieldError.max}${fieldError.unit ? ` ${fieldError.unit}` : unit ? ` ${unit}` : ''}`
    : '';
  const errorText = fieldError
    ? recordedHere > 0 && canRemove
      ? t('entry.exceedsRemove', { max: maxText, quantity: withUnit(recordedHere) })
      : t('entry.exceeds', { max: maxText })
    : rowError;

  function onAdd(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(quantity);
    if (!(value > 0)) {
      onRowError(t('entry.quantityRequired'));
      return;
    }
    onRowError(null);
    onFieldError(null);
    add.mutate(
      { boqNodeId: leaf.id, quantity: value },
      {
        onSuccess: () => setQuantity(''),
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) onConflict();
          const mapped = mapDprError(error, t('entry.saveFailed'));
          const mine = mapped.fieldErrors[leaf.id];
          if (mine) onFieldError(mine);
          else onRowError(mapped.formError);
        },
      },
    );
  }

  function onRemove(measurementId: string) {
    onRowError(null);
    remove.mutate(measurementId, {
      // The item's over-quantity error was about what is recorded here; removing an entry changes
      // that, so the stale error goes and a resubmit re-checks.
      onSuccess: () => onFieldError(null),
      // Not hidden: a refused removal (409 once the report is no longer editable) leaves the entry
      // on the report, and the reader must know that.
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) onConflict();
        onRowError(t('entry.removeFailed', { message: mapDprError(error, t('entry.saveFailed')).formError }));
      },
    });
  }

  return (
    <li className="px-3 py-3">
      <form onSubmit={onAdd} className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <Label htmlFor={inputId} className="block text-body-sm font-medium text-foreground">
            {lineLabel(leaf)}
          </Label>
          <p id={hintId} className="mt-0.5 text-caption text-muted-foreground">
            {hint}
            {recordedHere > 0 ? ` · ${t('entry.recordedHere', { quantity: withUnit(recordedHere) })}` : null}
          </p>
          {errorText ? (
            <p id={errorId} className="mt-1 text-caption font-medium text-danger">
              {errorText}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Input
            id={inputId}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.001"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            aria-label={t('entry.quantityLabel', { item: lineLabel(leaf) })}
            aria-describedby={errorText ? `${hintId} ${errorId}` : hintId}
            aria-invalid={errorText ? true : undefined}
            className="w-28"
          />
          <Button type="submit" variant="outline" size="sm" disabled={add.isPending}>
            {t('entry.record')}
          </Button>
        </div>
      </form>
      {!canRemove && measurements.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2 text-caption text-muted-foreground" aria-label={t('entry.recordedHere', { quantity: withUnit(recordedHere) })}>
          {measurements.map((m) => (
            <li key={m.id} className="rounded-full border border-border px-2 py-0.5 tabular-nums">
              {withUnit(m.quantity)}
            </li>
          ))}
        </ul>
      ) : null}
      {canRemove && measurements.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label={t('entry.recordedHere', { quantity: withUnit(recordedHere) })}>
          {measurements.map((m) => (
            <li key={m.id}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemove(m.id)}
                disabled={remove.isPending}
                aria-label={t('entry.removeLabel', { quantity: withUnit(m.quantity), item: lineLabel(leaf) })}
              >
                {t('entry.remove', { quantity: withUnit(m.quantity) })}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
