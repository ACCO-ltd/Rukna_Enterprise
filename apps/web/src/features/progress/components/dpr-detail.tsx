'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  ApprovalChain,
  Button,
  Combobox,
  FormField,
  Input,
  Label,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  type ApprovalStep,
} from '@erp/ui';
import { ArrowLeft } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { MediaUpload, type MediaUploadLabels } from '@/components/media-upload';
import { ApiError } from '@/lib/api-client';
import { getFileDownloadUrl } from '@/features/files/api/files-api';
import { useFileUpload } from '@/features/files/hooks/use-file-upload';
import { useSession } from '@/features/auth/session/use-session';
import { formatDate, formatNumber } from '@/lib/format';

import {
  useAddMeasurement,
  useApproveDpr,
  useAttachDprEvidence,
  useDpr,
  useProjectProgress,
  useReturnDpr,
  useSubmitDpr,
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

  const submit = useSubmitDpr(projectId, dprId);
  const approve = useApproveDpr(projectId, dprId);
  const returnDpr = useReturnDpr(projectId, dprId);
  const session = useSession();

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
          {dpr.status === 'SUBMITTED' ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setConfirm('return')}>
                {t('actions.return')}
              </Button>
              <Button size="sm" onClick={() => setConfirm('approve')}>
                {t('actions.approve')}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {dpr.status === 'SUBMITTED' && isSelfApprover ? (
        <Alert variant="warning" messages={[t('report.selfApprovalWarning')]} />
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
          {dpr.weather ? <Meta label={t('report.fields.weather')} value={dpr.weather} /> : null}
          {dpr.labourCount != null ? (
            <Meta label={t('report.fields.labourCount')} value={String(dpr.labourCount)} />
          ) : null}
          {dpr.delayReason ? <Meta label={t('report.fields.delayReason')} value={dpr.delayReason} /> : null}
          {dpr.narrative ? <Meta label={t('report.fields.narrative')} value={dpr.narrative} /> : null}
        </dl>
      </div>

      {/* Measurements */}
      <section className="rounded-panel border border-border bg-surface p-4 sm:p-5">
        <h4 className="text-sm font-semibold text-foreground">{t('measurement.title')}</h4>
        {editable ? (
          <AddMeasurementForm dprId={dprId} projectId={projectId} leaves={leaves} />
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{t('report.draftOnlyHint')}</p>
        )}
        {dpr.measurements.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('measurement.empty')}</p>
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
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white">▶</span>
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

function errText(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.messages.length > 0 ? error.messages[0]! : fallback;
}
