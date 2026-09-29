'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { ProgressMeasurementResponse } from '@erp/types';
import {
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormDialogSection,
  Input,
  Label,
  Notice,
  Skeleton,
  Textarea,
  useToast,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatDate, formatNumber } from '@/lib/format';

import { canRemoveEntry, isEditableDpr } from '../domain/my-reports';
import { mapDprError, type DprQuantityFieldError } from '../domain/dpr-errors';
import { progressViewHref } from '../domain/progress-views';
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
import { useProgressAccess } from '../hooks/use-progress-access';
import { lineLabel, useBoqLeaves, type ClaimableLine } from '../hooks/use-boq-leaves';
import { DprDetail, DprEvidence } from './dpr-detail';
import { DprLabourTable } from './dpr-labour-table';
import { DprStatusBadge } from './dpr-status-badge';

/**
 * The daily report, opened from Today in a `FormDialog` (ADR-039, size `xl`, full screen on a phone).
 *
 * An editable report (draft, returned, reopened) shows the entry form in four sections: Work done
 * (every BOQ item grouped by work package, a quantity input with its to-date figure, and the entries
 * already recorded), Labour and hours, Site notes, and Photos. Each entry saves as it is made (the API
 * has no batch save); "Save draft" and "Submit for review" first flush and await any site notes not
 * yet saved, and stay open if that fails. A report that is no longer editable opens read-only in the
 * same dialog.
 *
 * Dismissal is guarded: `busy` while submitting or flushing notes, `dirty` while a quantity, the notes
 * or the labour add-row line hold something typed but not saved.
 *
 * Work packages are not linked to users (`responsibleOwner` is free text), so the form shows ALL
 * items grouped by package rather than "my" packages (owner-approved).
 */
export function DprEntryDialog({
  projectId,
  dprId,
  onClose,
}: {
  projectId: string;
  /** The report to open; `null` closes the dialog. */
  dprId: string | null;
  onClose: () => void;
}) {
  // Keyed by report: opening another report starts from its own state, never the last one's.
  return dprId ? <DialogInner key={dprId} projectId={projectId} dprId={dprId} onClose={onClose} /> : null;
}

interface GuardState {
  dirty: boolean;
  busy: boolean;
}

function DialogInner({ projectId, dprId, onClose }: { projectId: string; dprId: string; onClose: () => void }) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const tDiscard = useTranslations('common.discardChanges');
  const locale = useLocale() as 'en';
  const dpr = useDpr(dprId);
  // The entry form owns the edits; it reports them up so the one dialog can guard its dismissal.
  const [guard, setGuard] = useState<GuardState>({ dirty: false, busy: false });

  const dateText = dpr.data ? (formatDate(dpr.data.reportDate, locale) ?? dpr.data.reportDate) : null;
  const status = dpr.data?.status;
  const editable = status ? isEditableDpr(status) : false;

  const title = dateText ? (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{t('entry.title', { date: dateText })}</span>
      {status && status !== 'DRAFT' ? (
        <span className="text-body-sm font-normal">
          <DprStatusBadge status={status} />
        </span>
      ) : null}
    </span>
  ) : (
    t('report.title')
  );

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      subtitle={editable ? t('entry.description') : undefined}
      size="xl"
      dirty={editable && guard.dirty}
      busy={editable && guard.busy}
      closeLabel={tCommon('close')}
      discardLabels={{
        title: tDiscard('title'),
        description: tDiscard('description'),
        confirm: tDiscard('confirm'),
        cancel: tDiscard('cancel'),
      }}
    >
      {dpr.isPending || dpr.isError ? (
        <>
          <FormDialogBody>
            {dpr.isPending ? (
              <Skeleton className="h-48 w-full rounded-panel" aria-hidden="true" />
            ) : (
              <Alert variant="error" messages={[t('states.loadFailed')]} />
            )}
          </FormDialogBody>
          <CloseFooter label={tCommon('close')} />
        </>
      ) : !editable ? (
        <>
          <FormDialogBody>
            <DprDetail projectId={projectId} dprId={dprId} onBack={onClose} />
          </FormDialogBody>
          <CloseFooter label={tCommon('close')} />
        </>
      ) : (
        <EntryForm projectId={projectId} dpr={dpr.data} onClose={onClose} onGuardChange={setGuard} />
      )}
    </FormDialog>
  );
}

function CloseFooter({ label }: { label: string }) {
  return (
    <FormDialogFooter>
      <FormDialogClose asChild>
        <Button type="button" variant="outline">
          {label}
        </Button>
      </FormDialogClose>
    </FormDialogFooter>
  );
}

interface ItemGroup {
  key: string;
  label: string;
  items: ClaimableLine[];
}

function EntryForm({
  projectId,
  dpr,
  onClose,
  onGuardChange,
}: {
  projectId: string;
  dpr: DailyProgressReportDetail;
  onClose: () => void;
  onGuardChange: (guard: GuardState) => void;
}) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const { toast } = useToast();
  const access = useProgressAccess();

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
  // Items with a quantity typed but not yet added, and whether the labour add-row line holds input.
  const [typedItems, setTypedItems] = useState<ReadonlySet<string>>(new Set());
  const [labourDirty, setLabourDirty] = useState(false);
  // Bumped when a submit comes back with item errors, so focus moves to the first one.
  const [focusRequest, setFocusRequest] = useState(0);

  const notesDirty = notes.trim() !== (dpr.narrative ?? '').trim();
  const dirty = typedItems.size > 0 || notesDirty || labourDirty;
  const guardBusy = busy || submit.isPending;
  useEffect(() => {
    onGuardChange({ dirty, busy: guardBusy });
  }, [dirty, guardBusy, onGuardChange]);

  const onItemTyped = useCallback((leafId: string, typed: boolean) => {
    setTypedItems((prev) => {
      if (prev.has(leafId) === typed) return prev;
      const next = new Set(prev);
      if (typed) next.add(leafId);
      else next.delete(leafId);
      return next;
    });
  }, []);

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
   * save failed — the caller then keeps the dialog open so nothing typed is lost.
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
        // it, so what the dialog shows is the current report.
        if (error instanceof ApiError && error.status === 409) refetchReport();
        if (Object.keys(mapped.fieldErrors).length > 0) setFocusRequest((n) => n + 1);
      },
    });
  }

  const loading = leavesPending || workPackages.isPending;

  return (
    <>
      <FormDialogBody>
        {dpr.status === 'RETURNED' && dpr.returnReason ? (
          <Notice tone="attention">{t('entry.returned', { reason: dpr.returnReason })}</Notice>
        ) : null}

        {formError ? <Alert variant="error" messages={[formError]} /> : null}

        <FormDialogSection
          title={t('entry.workDone')}
          description={
            <>
              {t('entry.workDoneHint')}
              {dpr.status === 'REOPENED' ? (
                <span className="mt-1 block text-foreground">{t('entry.reopenedNote')}</span>
              ) : null}
            </>
          }
        >
          {loading ? (
            <Skeleton className="h-32 w-full rounded-panel" aria-hidden="true" />
          ) : groups.length === 0 ? (
            <div className="space-y-2 rounded-panel border border-dashed border-border px-4 py-5">
              <p className="text-body-sm text-muted-foreground">{t('entry.noItems')}</p>
              {access.canManage ? (
                <Link
                  href={progressViewHref(projectId, 'setup')}
                  className="inline-block text-body-sm font-medium text-brand-primary underline underline-offset-4 hover:text-brand-primary-hover"
                >
                  {t('entry.noItemsSetupLink')}
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map((group) => (
                <div key={group.key} className="space-y-2">
                  <h4 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </h4>
                  <div className="overflow-hidden rounded-panel border border-border">
                    {/* Column header — visual only; every input carries its own accessible name. */}
                    <div
                      aria-hidden="true"
                      className={`hidden border-b border-border bg-surface-subtle px-3 py-2 text-caption font-medium text-muted-foreground ${ITEM_GRID}`}
                    >
                      <span>{t('entry.col.item')}</span>
                      <span>{t('entry.col.quantity')}</span>
                      <span>{t('entry.col.recorded')}</span>
                    </div>
                    <ul className="divide-y divide-border">
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
                          // delete one recorded before the reopen, so only later entries offer Remove.
                          canRemove={(m) => canRemoveEntry(dpr, m)}
                          onConflict={refetchReport}
                          onTypedChange={onItemTyped}
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
                </div>
              ))}
            </div>
          )}
        </FormDialogSection>

        <FormDialogSection title={t('entry.labour')}>
          <DprLabourTable dprId={dpr.id} rows={dpr.labourRows ?? []} onDirtyChange={setLabourDirty} />
        </FormDialogSection>

        <FormDialogSection title={t('entry.notes')}>
          <div className="space-y-1.5">
            <Label htmlFor="entry-notes-field" className="sr-only">
              {t('entry.notes')}
            </Label>
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
          </div>
        </FormDialogSection>

        <FormDialogSection title={t('entry.photos')}>
          <DprEvidence
            dprId={dpr.id}
            canUpload
            attachments={dpr.attachments}
            measurements={dpr.measurements}
            leafLabel={leafLabel}
            bare
          />
        </FormDialogSection>
      </FormDialogBody>

      <FormDialogFooter>
        <Button type="button" variant="outline" onClick={() => void onSaveDraft()} disabled={guardBusy}>
          {t('entry.saveDraft')}
        </Button>
        <Button type="button" onClick={() => void onSubmit()} disabled={guardBusy}>
          {t('entry.submit')}
        </Button>
      </FormDialogFooter>
    </>
  );
}

/** Item · quantity today · recorded on this report — from `sm`; a phone stacks them. */
const ITEM_GRID = 'sm:grid sm:grid-cols-[minmax(0,1fr)_15rem_minmax(0,14rem)] sm:gap-4';

function EntryItemRow({
  projectId,
  dprId,
  leaf,
  verifiedToDate,
  scope,
  measurements,
  canRemove,
  onConflict,
  onTypedChange,
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
  canRemove: (entry: ProgressMeasurementResponse) => boolean;
  onConflict: () => void;
  onTypedChange: (leafId: string, typed: boolean) => void;
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

  const typed = quantity.trim() !== '';
  useEffect(() => {
    onTypedChange(leaf.id, typed);
  }, [leaf.id, typed, onTypedChange]);
  // Unmounting (another report, or the item left the plan) takes its typed value with it.
  useEffect(() => () => onTypedChange(leaf.id, false), [leaf.id, onTypedChange]);

  const unit = leaf.unit ?? '';
  const withUnit = (n: number | string) => `${formatNumber(n, locale, 3) ?? n}${unit ? ` ${unit}` : ''}`;
  const recordedHere = measurements.reduce((sum, m) => sum + Number(m.quantity), 0);
  const removable = measurements.filter((m) => canRemove(m));
  const kept = measurements.filter((m) => !canRemove(m));
  const removableHere = removable.reduce((sum, m) => sum + Number(m.quantity), 0);
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
    ? removableHere > 0
      ? t('entry.exceedsRemove', { max: maxText, quantity: withUnit(removableHere) })
      : t('entry.exceeds', { max: maxText })
    : rowError;

  function onAdd(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
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
    <li className={`flex flex-col gap-3 px-3 py-3 ${ITEM_GRID} sm:items-start`}>
      {/* Item: code + description, and where it stands to date. */}
      <div className="min-w-0">
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

      {/* Quantity today, with its unit inside the field. */}
      <form onSubmit={onAdd} className="flex items-start gap-2">
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
          endSlot={unit ? <span className="text-caption text-muted-foreground">{unit}</span> : undefined}
          className="text-end tabular-nums"
        />
        <Button type="submit" variant="outline" disabled={add.isPending} className="shrink-0">
          {t('entry.record')}
        </Button>
      </form>

      {/* What this report already records for the item. */}
      <div className="min-w-0">
        {measurements.length > 0 ? (
          <ul
            className="flex flex-wrap items-center gap-2"
            aria-label={t('entry.recordedHere', { quantity: withUnit(recordedHere) })}
          >
            {/* Entries the approved report already carried: listed, never removable. */}
            {kept.map((m) => (
              <li
                key={m.id}
                className="rounded-full border border-border px-2.5 py-1 text-caption tabular-nums text-muted-foreground"
              >
                {withUnit(m.quantity)}
              </li>
            ))}
            {removable.map((m) => (
              <li key={m.id}>
                <Button
                  type="button"
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
        ) : (
          <p className="hidden text-caption text-muted-foreground sm:block sm:pt-2.5">{t('entry.nothingRecorded')}</p>
        )}
      </div>
    </li>
  );
}
