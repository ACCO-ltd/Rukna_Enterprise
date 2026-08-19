'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
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
} from '@erp/ui';
import { ArrowLeft, Download, Upload } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';
import { getFileDownloadUrl } from '@/features/files/api/files-api';
import { useFileUpload } from '@/features/files/hooks/use-file-upload';
import { formatDate, formatNumber } from '@/lib/format';

import {
  useAddMeasurement,
  useApproveDpr,
  useAttachDprEvidence,
  useDpr,
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

      {/* Header */}
      <div className="rounded-panel border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-h3 font-bold text-foreground">{formatDate(dpr.reportDate, locale)}</h3>
          <DprStatusBadge status={dpr.status} />
        </div>
        {isApproved ? (
          <p className="mt-2 text-sm text-success">{t('report.approvedHint')}</p>
        ) : null}
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Meta label={t('report.fields.preparedBy')} value={dpr.preparedBy} />
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
          <AddMeasurementForm dprId={dprId} leaves={leaves} />
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
      <section className="rounded-panel border border-border bg-surface p-4 sm:p-5">
        <h4 className="text-sm font-semibold text-foreground">{t('evidence.title')}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{t('evidence.hint')}</p>
        {!isApproved ? <EvidenceUpload dprId={dprId} /> : null}
        {dpr.attachments.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('evidence.empty')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {dpr.attachments.map((a, i) => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2 text-sm">
                <span>{t('evidence.item', { n: i + 1 })}</span>
                <EvidenceDownload platformFileId={a.platformFileId} label={t('actions.download')} />
              </li>
            ))}
          </ul>
        )}
      </section>

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
  leaves,
}: {
  dprId: string;
  leaves: ReturnType<typeof useBoqLeaves>['leaves'];
}) {
  const t = useTranslations('progress');
  const add = useAddMeasurement(dprId);

  const [boqNodeId, setBoqNodeId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qtyError = touched && !(Number(quantity) > 0) ? t('measurement.quantityRequired') : undefined;

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
        <Select id="m-leaf" value={boqNodeId} onChange={(e) => setBoqNodeId(e.target.value)}>
          <option value="">{t('measurement.boqNodePlaceholder')}</option>
          {leaves.map((leaf) => (
            <option key={leaf.id} value={leaf.id}>
              {lineLabel(leaf)}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">{t('measurement.leafOnlyHint')}</p>
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

function EvidenceUpload({ dprId }: { dprId: string }) {
  const t = useTranslations('progress');
  const upload = useFileUpload();
  const attach = useAttachDprEvidence(dprId);
  const [error, setError] = useState<string | null>(null);
  const busy = upload.isPending || attach.isPending;

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const fileId = await upload.mutateAsync(file);
      await attach.mutateAsync(fileId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('evidence.notReady'));
    }
  }

  return (
    <div className="mt-3">
      {error ? (
        <div className="mb-2">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-surface-hover">
        <Upload size={16} aria-hidden="true" />
        {busy ? t('states.loading') : t('actions.attachEvidence')}
        <input type="file" className="sr-only" onChange={(e) => void onChange(e)} disabled={busy} />
      </label>
    </div>
  );
}

function EvidenceDownload({ platformFileId, label }: { platformFileId: string; label: string }) {
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    try {
      const { url } = await getFileDownloadUrl(platformFileId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // Non-fatal: the row simply does not open. A retry re-signs the URL.
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="ghost" size="sm" onClick={() => void onClick()} disabled={busy}>
      <Download size={16} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </Button>
  );
}

function errText(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.messages.length > 0 ? error.messages[0]! : fallback;
}
