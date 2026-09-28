'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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

import { formatDate, formatNumber } from '@/lib/format';

import { isEditableDpr } from '../domain/my-reports';
import { mapDprError, type DprQuantityFieldError } from '../domain/dpr-errors';
import type { DailyProgressReportDetail } from '../api/progress-api';
import {
  useAddMeasurement,
  useDpr,
  usePatchDprContext,
  useProjectProgress,
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
 * photos. Each entry saves as it is made (the API has no batch save), so "Save draft" only closes
 * the sheet; "Submit for review" is the one primary. A report that is no longer editable opens
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
        {dprId ? <SheetInner projectId={projectId} dprId={dprId} onClose={onClose} /> : null}
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
  const { toast } = useToast();

  const { leaves, isPending: leavesPending } = useBoqLeaves(projectId);
  const workPackages = useWorkPackages(projectId);
  const progress = useProjectProgress(projectId);
  const submit = useSubmitDpr(projectId, dpr.id);

  const [fieldErrors, setFieldErrors] = useState<Record<string, DprQuantityFieldError>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

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
  const onThisReport = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of dpr.measurements) map.set(m.boqNodeId, (map.get(m.boqNodeId) ?? 0) + Number(m.quantity));
    return map;
  }, [dpr.measurements]);

  function onSubmit() {
    setFormError(null);
    setFieldErrors({});
    submit.mutate(undefined, {
      onSuccess: () => {
        toast({ tone: 'success', title: t('entry.submitted') });
        onClose();
      },
      onError: (error) => {
        const mapped = mapDprError(error, t('entry.saveFailed'));
        setFieldErrors(mapped.fieldErrors);
        setFormError(mapped.formError);
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
                      dprId={dpr.id}
                      leaf={leaf}
                      verifiedToDate={Number(verifiedByNode.get(leaf.id)?.verifiedToDate ?? 0)}
                      scope={verifiedByNode.get(leaf.id)?.measurableQuantity ?? leaf.quantity}
                      recordedHere={onThisReport.get(leaf.id) ?? 0}
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

        <SiteNotes dpr={dpr} />

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
        <Button onClick={onSubmit} disabled={submit.isPending}>
          {t('entry.submit')}
        </Button>
        <Button variant="outline" onClick={onClose}>
          {t('entry.saveDraft')}
        </Button>
      </SheetFooter>
    </>
  );
}

function EntryItemRow({
  dprId,
  leaf,
  verifiedToDate,
  scope,
  recordedHere,
  fieldError,
  rowError,
  onRowError,
  onFieldError,
}: {
  dprId: string;
  leaf: ClaimableLine;
  verifiedToDate: number;
  scope: string | null;
  recordedHere: number;
  fieldError: DprQuantityFieldError | undefined;
  rowError: string | undefined;
  onRowError: (message: string | null) => void;
  onFieldError: (error: DprQuantityFieldError | null) => void;
}) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const add = useAddMeasurement(dprId);
  const [quantity, setQuantity] = useState('');

  const unit = leaf.unit ?? '';
  const withUnit = (n: number | string) => `${formatNumber(n, locale, 3) ?? n}${unit ? ` ${unit}` : ''}`;
  const cumulative = verifiedToDate + recordedHere;
  const scopeNum = scope != null && scope !== '' ? Number(scope) : null;
  const hint =
    scopeNum != null && Number.isFinite(scopeNum)
      ? t('entry.toDate', { cumulative: withUnit(cumulative), total: withUnit(scopeNum) })
      : t('entry.toDateNoScope', { cumulative: withUnit(cumulative) });

  const inputId = `entry-qty-${leaf.id}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const errorText = fieldError
    ? t('entry.exceeds', { max: `${formatNumber(fieldError.max, locale, 3) ?? fieldError.max}${fieldError.unit ? ` ${fieldError.unit}` : unit ? ` ${unit}` : ''}` })
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
          const mapped = mapDprError(error, t('entry.saveFailed'));
          const mine = mapped.fieldErrors[leaf.id];
          if (mine) onFieldError(mine);
          else onRowError(mapped.formError ?? t('entry.saveFailed'));
        },
      },
    );
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
    </li>
  );
}

/** The day's narrative, saved when the field loses focus (only if it changed). */
function SiteNotes({ dpr }: { dpr: DailyProgressReportDetail }) {
  const t = useTranslations('progress');
  const patch = usePatchDprContext(dpr.id);
  const [notes, setNotes] = useState(dpr.narrative ?? '');
  const [error, setError] = useState<string | null>(null);

  function onBlur() {
    const next = notes.trim();
    if (next === (dpr.narrative ?? '').trim()) return;
    setError(null);
    patch.mutate(
      { narrative: next || undefined },
      { onError: (e) => setError(mapDprError(e, t('entry.saveFailed')).formError) },
    );
  }

  return (
    <section aria-labelledby="entry-notes" className="space-y-2">
      <h3 id="entry-notes" className="text-body font-semibold text-foreground">
        <label htmlFor="entry-notes-field">{t('entry.notes')}</label>
      </h3>
      <Textarea
        id="entry-notes-field"
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={onBlur}
        aria-describedby="entry-notes-hint"
      />
      <p id="entry-notes-hint" className="text-caption text-muted-foreground">
        {t('entry.notesHint')}
      </p>
      {error ? <p className="text-caption font-medium text-danger">{error}</p> : null}
    </section>
  );
}
