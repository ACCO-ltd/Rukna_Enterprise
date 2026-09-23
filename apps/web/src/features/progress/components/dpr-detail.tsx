'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  ApprovalChain,
  Badge,
  Button,
  Combobox,
  FormField,
  Input,
  Label,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  Textarea,
  type ApprovalStep,
} from '@erp/ui';
import { ArrowLeft, Play, Trash2 } from 'lucide-react';
import type { DprLabourRowResponse, DprEquipmentRowResponse, DprObservationResponse } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { MediaUpload, type MediaUploadLabels } from '@/components/media-upload';
import { ApiError } from '@/lib/api-client';
import { getFileDownloadUrl } from '@/features/files/api/files-api';
import { useFileUpload } from '@/features/files/hooks/use-file-upload';
import { useSession } from '@/features/auth/session/use-session';
import { usePermissions } from '@/features/auth/permissions/can';
import { formatDate, formatNumber } from '@/lib/format';

import {
  useAddMeasurement,
  useApproveDpr,
  useAttachDprEvidence,
  useDpr,
  useProjectProgress,
  useReturnDpr,
  useSubmitDpr,
  useAddLabourRow,
  useRemoveLabourRow,
  useAddEquipmentRow,
  useRemoveEquipmentRow,
  useAddObservation,
  useRemoveObservation,
} from '../hooks/use-progress';
import { lineLabel, useBoqLeaves } from '../hooks/use-boq-leaves';
import { DprStatusBadge } from './dpr-status-badge';

export function DprDetail({
  projectId,
  dprId,
  onBack,
}: {
  projectId: string;
  dprId: string;
  onBack: () => void;
}) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const { data: dpr, isPending, isError, refetch, isFetching } = useDpr(dprId);
  const { leaves } = useBoqLeaves(projectId);
  const leafLabel = useMemo(() => new Map(leaves.map((l) => [l.id, lineLabel(l)])), [leaves]);
  const leafMap = useMemo(() => new Map(leaves.map((l) => [l.id, l])), [leaves]);

  const submit = useSubmitDpr(projectId, dprId);
  const approve = useApproveDpr(projectId, dprId);
  const returnDpr = useReturnDpr(projectId, dprId);
  const session = useSession();
  const { can } = usePermissions();
  const progress = useProjectProgress(projectId);
  const progressByNode = useMemo(
    () => new Map((progress.data ?? []).map((line) => [line.boqNodeId, line])),
    [progress.data],
  );

  const [confirm, setConfirm] = useState<'approve' | 'return' | null>(null);

  const backButton = (
    <Button variant="ghost" size="sm" onClick={onBack}>
      <ArrowLeft size={16} className="rtl:rotate-180" aria-hidden="true" />
      {t('report.backToList')}
    </Button>
  );

  if (isPending) {
    return (
      <div className="space-y-4">
        {backButton}
        <Skeleton className="h-40 w-full" aria-hidden="true" />
        <span className="sr-only">{tCommon('loading')}</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        {backButton}
        <Alert variant="error" messages={[t('states.loadFailed')]}>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
              {t('actions.retry')}
            </Button>
          </div>
        </Alert>
      </div>
    );
  }

  const editable = dpr.status === 'DRAFT' || dpr.status === 'RETURNED';
  const isApproved = dpr.status === 'APPROVED';

  const currentUserId = session.user?.id ?? null;
  // Surfaces (does not block) the separation-of-duties gap: the same person can raise and approve a
  // report until a governance workflow enforces preparer≠approver (ADR-021 §7, redesign spec).
  const isSelfApprover =
    currentUserId != null && (currentUserId === dpr.preparedBy || currentUserId === dpr.submittedBy);
  const canApprove = can('approve:progress') && !isSelfApprover;

  // Provenance chain — where the report is and who prepared it. Prepared is always done; the rest
  // follows the DPR lifecycle. RETURNED/REOPENED are editable-again, so they read as "to submit".
  const submittedReached = dpr.status === 'SUBMITTED' || dpr.status === 'APPROVED';
  const chain: ApprovalStep[] = [
    { id: 'prepared', title: t('report.chain.prepared'), actor: dpr.preparedByName, state: 'approved' },
    { id: 'submitted', title: t('report.chain.submitted'), state: submittedReached ? 'approved' : 'current' },
    {
      id: 'approved',
      title: t('report.chain.approved'),
      state: dpr.status === 'APPROVED' ? 'approved' : dpr.status === 'SUBMITTED' ? 'current' : 'upcoming',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {backButton}
        <div className="flex items-center gap-2">
          {editable ? (
            <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending}>
              {t('actions.submit')}
            </Button>
          ) : null}
          {dpr.status === 'SUBMITTED' && can('approve:progress') ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setConfirm('return')}>
                {t('actions.return')}
              </Button>
              <Button size="sm" onClick={() => setConfirm('approve')} disabled={!canApprove}>
                {t('actions.approve')}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {dpr.status === 'SUBMITTED' && isSelfApprover && can('approve:progress') ? (
        <Alert variant="warning" messages={[t('report.selfApprovalBlocked')]} />
      ) : null}

      {/* Header */}
      <div className="rounded-panel border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-h3 font-bold text-foreground">{formatDate(dpr.reportDate, locale)}</h3>
          <DprStatusBadge status={dpr.status} />
        </div>
        <div className="mt-3 border-t border-border pt-3">
          <ApprovalChain steps={chain} label={t('report.chain.label')} />
        </div>
        {isApproved ? (
          <p className="mt-2 text-sm text-success">{t('report.approvedHint')}</p>
        ) : null}
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Meta label={t('report.fields.preparedBy')} value={dpr.preparedByName ?? dpr.preparedBy} />
          {dpr.submittedAt ? (
            <Meta
              label={t('report.fields.submittedAt')}
              value={formatDate(dpr.submittedAt, locale) ?? dpr.submittedAt}
            />
          ) : null}
          {dpr.weather ? <Meta label={t('report.fields.weather')} value={dpr.weather} /> : null}
          {dpr.labourCount != null ? (
            <Meta label={t('report.fields.labourCount')} value={String(dpr.labourCount)} />
          ) : null}
          {dpr.delayReason ? <Meta label={t('report.fields.delayReason')} value={dpr.delayReason} /> : null}
          {dpr.narrative ? <Meta label={t('report.fields.narrative')} value={dpr.narrative} /> : null}
          {dpr.returnReason ? (
            <div className="sm:col-span-2">
              <Meta label={t('report.fields.returnReason')} value={dpr.returnReason} />
            </div>
          ) : null}
        </dl>
      </div>

      {/* Measurements */}
      <section className="rounded-panel border border-border bg-surface p-4 sm:p-5">
        <h4 className="text-sm font-semibold text-foreground">{t('measurement.title')}</h4>
        {editable ? (
          <AddMeasurementForm dprId={dprId} projectId={projectId} leaves={leaves} />
        ) : null}
        {dpr.measurements.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('measurement.empty')}</p>
        ) : dpr.status === 'SUBMITTED' ? (
          <TableScroll className="mt-3" aria-label={t('measurement.title')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('measurement.boqNode')}</TableHead>
                  <TableHead>{t('measurement.review.unit')}</TableHead>
                  <TableHead numeric>{t('measurement.review.priorVerified')}</TableHead>
                  <TableHead numeric>{t('measurement.review.today')}</TableHead>
                  <TableHead numeric>{t('measurement.review.cumulative')}</TableHead>
                  <TableHead numeric>{t('measurement.review.scope')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dpr.measurements.map((m) => {
                  const line = progressByNode.get(m.boqNodeId);
                  const leaf = leafMap.get(m.boqNodeId);
                  const priorVerified = Number(line?.verifiedToDate ?? 0);
                  const today = Number(m.quantity);
                  const cumulative = priorVerified + today;
                  const scope = Number(line?.measurableQuantity ?? leaf?.quantity ?? 0);
                  const exceeds = scope > 0 && cumulative > scope;
                  return (
                    <TableRow key={m.id}>
                      <TableCell>{leafLabel.get(m.boqNodeId) ?? m.boqNodeId}</TableCell>
                      <TableCell className="text-muted-foreground">{leaf?.unit ?? '—'}</TableCell>
                      <TableCell numeric className="tabular-nums text-muted-foreground">
                        {formatNumber(priorVerified, locale, 3)}
                      </TableCell>
                      <TableCell numeric className="tabular-nums font-medium">
                        {formatNumber(today, locale, 3)}
                      </TableCell>
                      <TableCell
                        numeric
                        className={exceeds ? 'tabular-nums text-warning' : 'tabular-nums'}
                        title={exceeds ? t('measurement.review.cumulativeExceedsScope') : undefined}
                      >
                        {formatNumber(cumulative, locale, 3)}
                        {exceeds ? ' !' : ''}
                      </TableCell>
                      <TableCell numeric className="tabular-nums text-muted-foreground">
                        {scope > 0 ? formatNumber(scope, locale, 3) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableScroll>
        ) : (
          <TableScroll className="mt-3" aria-label={t('measurement.title')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('measurement.boqNode')}</TableHead>
                  <TableHead numeric>{t('measurement.quantity')}</TableHead>
                  <TableHead>{t('measurement.notes')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dpr.measurements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{leafLabel.get(m.boqNodeId) ?? m.boqNodeId}</TableCell>
                    <TableCell numeric className="whitespace-nowrap tabular-nums">
                      {formatNumber(m.quantity, locale, 3)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </section>

      {/* Evidence */}
      <DprEvidence dprId={dprId} canUpload={!isApproved} attachments={dpr.attachments} />

      {/* Section C — Labour */}
      <LabourSection dprId={dprId} rows={dpr.labourRows ?? []} editable={editable} />

      {/* Section C — Equipment */}
      <EquipmentSection dprId={dprId} rows={dpr.equipmentRows ?? []} editable={editable} />

      {/* Section D — Observations + tomorrow plan */}
      <ObservationsSection dprId={dprId} rows={dpr.observations ?? []} editable={editable} />

      {dpr.tomorrowPlan ? (
        <section className="rounded-panel border border-border bg-surface p-4 sm:p-5">
          <h4 className="text-sm font-semibold text-foreground">{t('context.tomorrowPlan')}</h4>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{dpr.tomorrowPlan}</p>
        </section>
      ) : null}

      {confirm === 'approve' ? (
        <ConfirmActionDialog
          title={t('report.approveConfirmTitle')}
          description={t('report.approveConfirmBody')}
          confirmLabel={t('actions.approve')}
          isPending={approve.isPending}
          errorMessage={approve.isError ? errText(approve.error, t('states.loadFailed')) : undefined}
          onConfirm={() => approve.mutate(undefined, { onSuccess: () => setConfirm(null) })}
          onDismiss={() => {
            if (!approve.isPending) setConfirm(null);
          }}
        />
      ) : null}

      {confirm === 'return' ? (
        <ConfirmActionDialog
          title={t('report.returnConfirmTitle')}
          description={t('report.returnConfirmBody')}
          confirmLabel={t('actions.return')}
          reason={{ required: true, label: t('report.returnReason.label'), hint: t('report.returnReason.placeholder'), maxLength: 255 }}
          isPending={returnDpr.isPending}
          errorMessage={returnDpr.isError ? errText(returnDpr.error, t('states.loadFailed')) : undefined}
          onConfirm={(reason) => returnDpr.mutate(reason, { onSuccess: () => setConfirm(null) })}
          onDismiss={() => {
            if (!returnDpr.isPending) setConfirm(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 font-medium text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function AddMeasurementForm({
  dprId,
  projectId,
  leaves,
}: {
  dprId: string;
  projectId: string;
  leaves: ReturnType<typeof useBoqLeaves>['leaves'];
}) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en' | 'ar';
  const add = useAddMeasurement(dprId);
  const progress = useProjectProgress(projectId);

  const [boqNodeId, setBoqNodeId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () => leaves.map((leaf) => ({ value: leaf.id, label: lineLabel(leaf), hint: leaf.unit ?? undefined })),
    [leaves],
  );
  const progressByNode = useMemo(
    () => new Map((progress.data ?? []).map((line) => [line.boqNodeId, line])),
    [progress.data],
  );

  const qtyError = touched && !(Number(quantity) > 0) ? t('measurement.quantityRequired') : undefined;

  // Remaining scope so the user never guesses against the CONST-PROG-009 cap (verified ≤ scope).
  // Scope + unit come from the BOQ leaf; verified-to-date is what other approved reports already
  // count (this draft's own measurements are not verified yet), which is exactly the cap basis.
  const selectedLeaf = boqNodeId ? leaves.find((l) => l.id === boqNodeId) ?? null : null;
  const line = boqNodeId ? progressByNode.get(boqNodeId) : undefined;
  const scopeStr = line?.measurableQuantity ?? selectedLeaf?.quantity ?? null;
  const scopeNum = scopeStr != null ? Number(scopeStr) : null;
  const verifiedNum = line ? Number(line.verifiedToDate) : 0;
  const remainingNum = scopeNum != null ? scopeNum - verifiedNum : null;
  const unit = selectedLeaf?.unit ?? '';
  const exceeds = remainingNum != null && Number(quantity) > remainingNum;
  const withUnit = (n: number) => `${formatNumber(n, locale, 3)}${unit ? ` ${unit}` : ''}`;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!boqNodeId || !(Number(quantity) > 0)) return;
    add.mutate(
      { boqNodeId, quantity: Number(quantity), notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          setBoqNodeId('');
          setQuantity('');
          setNotes('');
          setTouched(false);
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : t('measurement.title')),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 grid gap-3 sm:grid-cols-2" aria-label={t('measurement.add')}>
      {error ? (
        <div className="sm:col-span-2">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Label htmlFor="m-leaf">{t('measurement.boqNode')}</Label>
        <div className="mt-1">
          <Combobox
            id="m-leaf"
            value={boqNodeId}
            onChange={(value) => setBoqNodeId(value)}
            options={options}
            placeholder={t('measurement.boqNodePlaceholder')}
            searchPlaceholder={t('measurement.boqNodeSearch')}
            emptyLabel={t('measurement.boqNodeEmpty')}
          />
        </div>
        {selectedLeaf && scopeNum != null ? (
          <p className={exceeds ? 'mt-1 text-xs text-warning' : 'mt-1 text-xs text-muted-foreground'}>
            {t('measurement.scopeHint', {
              scope: withUnit(scopeNum),
              verified: withUnit(verifiedNum),
              remaining: withUnit(remainingNum ?? 0),
            })}
            {exceeds ? ` ${t('measurement.exceedsRemaining')}` : ''}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">{t('measurement.leafOnlyHint')}</p>
        )}
      </div>
      <FormField htmlFor="m-qty" label={t('measurement.quantity')} error={qtyError}>
        <Input id="m-qty" type="number" min="0" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </FormField>
      <FormField htmlFor="m-notes" label={t('measurement.notes')}>
        <Input id="m-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={add.isPending || !boqNodeId}>
          {t('measurement.add')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Evidence section: a multi-file photo/video uploader over a thumbnail gallery of what's attached.
 * Upload is offered only while the report is not approved (an approved report is immutable). Each
 * stored attachment resolves its own signed URL, which doubles as the thumbnail and carries the
 * mime type used to pick <img> vs <video>.
 */
function DprEvidence({
  dprId,
  canUpload,
  attachments,
}: {
  dprId: string;
  canUpload: boolean;
  attachments: Array<{ id: string; platformFileId: string }>;
}) {
  const t = useTranslations('progress');
  const upload = useFileUpload();
  const attach = useAttachDprEvidence(dprId);

  const onUpload = async (file: File) => {
    const fileId = await upload.mutateAsync(file);
    await attach.mutateAsync(fileId);
  };

  const labels: MediaUploadLabels = {
    dropHint: t('evidence.dropHint'),
    browse: t('evidence.browse'),
    tooLargeImage: t('evidence.tooLargeImage'),
    tooLargeVideo: t('evidence.tooLargeVideo'),
    wrongType: t('evidence.wrongType'),
    uploading: t('evidence.uploading'),
    failed: t('evidence.failed'),
    retry: t('evidence.retry'),
    remove: t('evidence.remove'),
  };

  return (
    <section className="rounded-panel border border-border bg-surface p-4 sm:p-5">
      <h4 className="text-sm font-semibold text-foreground">{t('evidence.title')}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{t('evidence.hint')}</p>
      {canUpload ? (
        <div className="mt-3">
          <MediaUpload onUpload={onUpload} labels={labels} />
        </div>
      ) : null}
      {attachments.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('evidence.empty')}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {attachments.map((a) => (
            <EvidenceTile key={a.id} platformFileId={a.platformFileId} />
          ))}
        </ul>
      )}
    </section>
  );
}

function EvidenceTile({ platformFileId }: { platformFileId: string }) {
  const t = useTranslations('progress');
  // The signed URL is the thumbnail src AND the open-in-new-tab target, and it carries the mime type
  // that decides <img> vs <video>. Cached under its ~15-min expiry so a gallery is not a burst of
  // identical re-signs.
  const query = useQuery({
    queryKey: ['file-download', platformFileId],
    queryFn: () => getFileDownloadUrl(platformFileId),
    staleTime: 10 * 60 * 1000,
  });

  if (query.isPending) {
    return <li className="aspect-square animate-pulse rounded-control bg-muted" aria-hidden="true" />;
  }
  if (query.isError || !query.data) {
    return (
      <li className="flex aspect-square items-center justify-center rounded-control border border-border bg-surface px-2 text-center text-caption text-muted-foreground">
        {t('evidence.unavailable')}
      </li>
    );
  }

  const { url, originalName, mimeType } = query.data;
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');

  return (
    <li className="relative aspect-square overflow-hidden rounded-control border border-border bg-muted">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
        title={originalName}
      >
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset
          <img src={url} alt={originalName} className="h-full w-full object-cover" />
        ) : isVideo ? (
          <video src={url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
        ) : (
          <span className="flex h-full w-full items-center justify-center px-2 text-center text-caption text-muted-foreground">
            {originalName}
          </span>
        )}
        {isVideo ? (
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white">
              <Play size={14} className="fill-current" aria-hidden="true" />
            </span>
          </span>
        ) : null}
        <span
          className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-micro text-white"
          title={originalName}
        >
          {originalName}
        </span>
      </a>
    </li>
  );
}

// ─── Section C: Labour ───────────────────────────────────────────────────────────────────

function LabourSection({
  dprId,
  rows,
  editable,
}: {
  dprId: string;
  rows: DprLabourRowResponse[];
  editable: boolean;
}) {
  const t = useTranslations('progress');
  const add = useAddLabourRow(dprId);
  const remove = useRemoveLabourRow(dprId);

  const [trade, setTrade] = useState('');
  const [headcount, setHeadcount] = useState('');
  const [contractor, setContractor] = useState('');
  const [hours, setHours] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!trade.trim() || !(Number(headcount) >= 0)) return;
    setError(null);
    add.mutate(
      {
        trade: trade.trim(),
        headcount: Number(headcount),
        contractor: contractor.trim() || undefined,
        hours: hours ? Number(hours) : undefined,
      },
      {
        onSuccess: () => {
          setTrade('');
          setHeadcount('');
          setContractor('');
          setHours('');
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : t('states.loadFailed')),
      },
    );
  }

  return (
    <section className="rounded-panel border border-border bg-surface p-4 sm:p-5">
      <h4 className="text-sm font-semibold text-foreground">{t('labour.title')}</h4>
      {rows.length > 0 ? (
        <TableScroll className="mt-3" aria-label={t('labour.title')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('labour.fields.trade')}</TableHead>
                <TableHead numeric>{t('labour.fields.headcount')}</TableHead>
                <TableHead>{t('labour.fields.contractor')}</TableHead>
                <TableHead numeric>{t('labour.fields.hours')}</TableHead>
                {editable ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.trade}</TableCell>
                  <TableCell numeric className="tabular-nums">{row.headcount}</TableCell>
                  <TableCell className="text-muted-foreground">{row.contractor ?? '—'}</TableCell>
                  <TableCell numeric className="tabular-nums text-muted-foreground">
                    {row.hours ?? '—'}
                  </TableCell>
                  {editable ? (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('labour.remove')}
                        onClick={() => remove.mutate(row.id)}
                        disabled={remove.isPending}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{t('labour.empty')}</p>
      )}
      {editable ? (
        <form onSubmit={onAdd} className="mt-3 grid gap-2 sm:grid-cols-4" aria-label={t('labour.add')}>
          {error ? (
            <div className="sm:col-span-4">
              <Alert variant="error" messages={[error]} />
            </div>
          ) : null}
          <FormField htmlFor="lr-trade" label={t('labour.fields.trade')}>
            <Input
              id="lr-trade"
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
              placeholder={t('labour.tradePlaceholder')}
            />
          </FormField>
          <FormField htmlFor="lr-count" label={t('labour.fields.headcount')}>
            <Input id="lr-count" type="number" min="0" value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
          </FormField>
          <FormField htmlFor="lr-contractor" label={t('labour.fields.contractor')}>
            <Input id="lr-contractor" value={contractor} onChange={(e) => setContractor(e.target.value)} />
          </FormField>
          <FormField htmlFor="lr-hours" label={t('labour.fields.hours')}>
            <Input id="lr-hours" type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
          </FormField>
          <div className="sm:col-span-4">
            <Button type="submit" size="sm" disabled={add.isPending || !trade.trim()}>
              {add.isPending ? t('labour.saving') : t('labour.add')}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

// ─── Section C: Equipment ────────────────────────────────────────────────────────────────

const EQUIPMENT_CONDITIONS = ['working', 'breakdown', 'idle', 'maintenance'] as const;

function EquipmentSection({
  dprId,
  rows,
  editable,
}: {
  dprId: string;
  rows: DprEquipmentRowResponse[];
  editable: boolean;
}) {
  const t = useTranslations('progress');
  const add = useAddEquipmentRow(dprId);
  const remove = useRemoveEquipmentRow(dprId);

  const [equipType, setEquipType] = useState('');
  const [count, setCount] = useState('');
  const [hoursWorked, setHoursWorked] = useState('');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!equipType.trim() || !(Number(count) >= 0)) return;
    setError(null);
    add.mutate(
      {
        equipmentType: equipType.trim(),
        count: Number(count),
        hoursWorked: hoursWorked ? Number(hoursWorked) : undefined,
        condition: condition || undefined,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          setEquipType('');
          setCount('');
          setHoursWorked('');
          setCondition('');
          setNotes('');
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : t('states.loadFailed')),
      },
    );
  }

  return (
    <section className="rounded-panel border border-border bg-surface p-4 sm:p-5">
      <h4 className="text-sm font-semibold text-foreground">{t('equipment.title')}</h4>
      {rows.length > 0 ? (
        <TableScroll className="mt-3" aria-label={t('equipment.title')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('equipment.fields.type')}</TableHead>
                <TableHead numeric>{t('equipment.fields.count')}</TableHead>
                <TableHead numeric>{t('equipment.fields.hours')}</TableHead>
                <TableHead>{t('equipment.fields.condition')}</TableHead>
                {editable ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.equipmentType}</TableCell>
                  <TableCell numeric className="tabular-nums">{row.count}</TableCell>
                  <TableCell numeric className="tabular-nums text-muted-foreground">
                    {row.hoursWorked ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.condition ?? '—'}</TableCell>
                  {editable ? (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('equipment.remove')}
                        onClick={() => remove.mutate(row.id)}
                        disabled={remove.isPending}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{t('equipment.empty')}</p>
      )}
      {editable ? (
        <form onSubmit={onAdd} className="mt-3 grid gap-2 sm:grid-cols-3" aria-label={t('equipment.add')}>
          {error ? (
            <div className="sm:col-span-3">
              <Alert variant="error" messages={[error]} />
            </div>
          ) : null}
          <FormField htmlFor="eq-type" label={t('equipment.fields.type')}>
            <Input
              id="eq-type"
              value={equipType}
              onChange={(e) => setEquipType(e.target.value)}
              placeholder={t('equipment.typePlaceholder')}
            />
          </FormField>
          <FormField htmlFor="eq-count" label={t('equipment.fields.count')}>
            <Input id="eq-count" type="number" min="0" value={count} onChange={(e) => setCount(e.target.value)} />
          </FormField>
          <FormField htmlFor="eq-hours" label={t('equipment.fields.hours')}>
            <Input id="eq-hours" type="number" min="0" step="0.5" value={hoursWorked} onChange={(e) => setHoursWorked(e.target.value)} />
          </FormField>
          <FormField htmlFor="eq-condition" label={t('equipment.fields.condition')}>
            <Select id="eq-condition" value={condition} onChange={(value) => setCondition(value)}>
              <option value="">—</option>
              {EQUIPMENT_CONDITIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </FormField>
          <div className="sm:col-span-2">
            <FormField htmlFor="eq-notes" label={t('equipment.fields.notes')}>
              <Input id="eq-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" size="sm" disabled={add.isPending || !equipType.trim()}>
              {add.isPending ? t('equipment.saving') : t('equipment.add')}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

// ─── Section D: Observations ─────────────────────────────────────────────────────────────

const OBS_CATEGORIES = ['ISSUE', 'DELAY', 'SAFETY'] as const;
type ObsCategory = (typeof OBS_CATEGORIES)[number];

const SEVERITY_OPTIONS = ['low', 'medium', 'high'] as const;

const OBS_TONES: Record<ObsCategory, 'warning' | 'danger' | 'info'> = {
  ISSUE: 'warning',
  DELAY: 'warning',
  SAFETY: 'danger',
};

function ObservationsSection({
  dprId,
  rows,
  editable,
}: {
  dprId: string;
  rows: DprObservationResponse[];
  editable: boolean;
}) {
  const t = useTranslations('progress');
  const add = useAddObservation(dprId);
  const remove = useRemoveObservation(dprId);

  const [category, setCategory] = useState<ObsCategory>('ISSUE');
  const [description, setDescription] = useState('');
  const [affectedWork, setAffectedWork] = useState('');
  const [severity, setSeverity] = useState('');
  const [followUpOwner, setFollowUpOwner] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setError(null);
    add.mutate(
      {
        category,
        description: description.trim(),
        affectedWork: affectedWork.trim() || undefined,
        severity: severity || undefined,
        followUpOwner: followUpOwner.trim() || undefined,
      },
      {
        onSuccess: () => {
          setDescription('');
          setAffectedWork('');
          setSeverity('');
          setFollowUpOwner('');
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : t('states.loadFailed')),
      },
    );
  }

  return (
    <section className="rounded-panel border border-border bg-surface p-4 sm:p-5">
      <h4 className="text-sm font-semibold text-foreground">{t('observations.title')}</h4>
      {rows.length > 0 ? (
        <ul className="mt-3 divide-y divide-border">
          {rows.map((obs) => (
            <li key={obs.id} className="flex items-start gap-3 py-3">
              <Badge tone={OBS_TONES[obs.category as ObsCategory] ?? 'info'} className="mt-0.5 shrink-0">
                {t(`observations.categories.${obs.category}`)}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{obs.description}</p>
                {obs.affectedWork ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{obs.affectedWork}</p>
                ) : null}
                {obs.severity ? (
                  <p className="mt-0.5 text-xs text-muted-foreground capitalize">{obs.severity}</p>
                ) : null}
                {obs.followUpOwner ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">→ {obs.followUpOwner}</p>
                ) : null}
              </div>
              {editable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('observations.remove')}
                  onClick={() => remove.mutate(obs.id)}
                  disabled={remove.isPending}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{t('observations.empty')}</p>
      )}
      {editable ? (
        <form onSubmit={onAdd} className="mt-3 grid gap-2 sm:grid-cols-2" aria-label={t('observations.add')}>
          {error ? (
            <div className="sm:col-span-2">
              <Alert variant="error" messages={[error]} />
            </div>
          ) : null}
          <FormField htmlFor="obs-cat" label={t('observations.fields.category')}>
            <Select id="obs-cat" value={category} onChange={(v) => setCategory(v as ObsCategory)}>
              {OBS_CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`observations.categories.${c}`)}</option>
              ))}
            </Select>
          </FormField>
          <FormField htmlFor="obs-severity" label={t('observations.fields.severity')}>
            <Select id="obs-severity" value={severity} onChange={(v) => setSeverity(v)}>
              <option value="">—</option>
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>{t(`observations.severities.${s}`)}</option>
              ))}
            </Select>
          </FormField>
          <div className="sm:col-span-2">
            <FormField htmlFor="obs-desc" label={t('observations.fields.description')}>
              <Textarea
                id="obs-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </FormField>
          </div>
          <FormField htmlFor="obs-affected" label={t('observations.fields.affectedWork')}>
            <Input id="obs-affected" value={affectedWork} onChange={(e) => setAffectedWork(e.target.value)} />
          </FormField>
          <FormField htmlFor="obs-owner" label={t('observations.fields.followUpOwner')}>
            <Input id="obs-owner" value={followUpOwner} onChange={(e) => setFollowUpOwner(e.target.value)} />
          </FormField>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={add.isPending || !description.trim()}>
              {add.isPending ? t('observations.saving') : t('observations.add')}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function errText(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.messages.length > 0 ? error.messages[0]! : fallback;
}
