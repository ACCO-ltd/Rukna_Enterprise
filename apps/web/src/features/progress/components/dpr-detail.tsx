'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  ApprovalChain,
  Avatar,
  Combobox,
  FormField,
  Input,
  Label,
  Select,
  Skeleton,
  Textarea,
  useToast,
  type ApprovalStep,
} from '@erp/ui';
import {
  ArrowLeft,
  Check,
  HardHat,
  Image as ImageIcon,
  Play,
  Ruler,
  Send,
  TriangleAlert,
  Trash2,
  Undo2,
  Wrench,
} from 'lucide-react';
import type {
  DprLabourRowResponse,
  DprEquipmentRowResponse,
  DprObservationResponse,
  ProgressMeasurementResponse,
} from '@erp/types';

import type { DailyProgressReportDetail } from '../api/progress-api';

import {
  RefButton,
  RefCard,
  RefCardBody,
  RefCardHeader,
  RefPill,
  RefStatTile,
  RefTable,
  RefTableScroll,
  RefTbody,
  RefTd,
  RefTh,
  RefThead,
  RefTr,
  type RefTone,
} from './ref-ui';

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
  usePatchDprContext,
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
import { useProject } from '@/features/projects/hooks/use-project';
import { useSuppliers } from '@/features/procurement/hooks/use-procurement';

/**
 * Bounded site-condition options (ADR-021 redesign §5.2). Stored as their readable string so
 * analysis can group by a known set — never free-typed prose that reads "rainy" / "Rainy" /
 * "RAINY". A hot-climate (Banaadir) weather set; a delay taxonomy that seeds later delay/EOT
 * analysis.
 */
const WEATHER_OPTIONS = [
  'Clear',
  'Sunny / hot',
  'Partly cloudy',
  'Overcast',
  'Light rain',
  'Heavy rain',
  'Thunderstorm',
  'Windy',
  'Dust / haze',
  'Fog',
] as const;

const DELAY_OPTIONS = [
  'No delay',
  'Weather',
  'Material shortage',
  'Labour shortage',
  'Equipment breakdown',
  'Client instruction',
  'Design change / RFI',
  'Site access restriction',
  'Utilities / services',
  'Permit / authority',
  'Other',
] as const;

/** Bounded trade list — same reasoning as weather/delay: a known set analysis can group by. */
const TRADE_OPTIONS = [
  'Mason',
  'Carpenter',
  'Steel fixer',
  'Electrician',
  'Plumber',
  'Painter',
  'Tiler',
  'Plasterer',
  'Welder',
  'Scaffolder',
  'Labourer',
  'Foreman / Supervisor',
  'Surveyor',
  'Other',
] as const;

const EQUIPMENT_TYPE_OPTIONS = [
  'Excavator',
  'Concrete pump',
  'Concrete mixer',
  'Tower crane',
  'Mobile crane',
  'Compactor / Roller',
  'Generator',
  'Scaffolding',
  'Dump truck',
  'Bulldozer',
  'Loader',
  'Water tanker',
  'Other',
];

const SHIFT_OPTIONS = ['Morning', 'Afternoon', 'Night', 'Full day'] as const;

const refFieldClass = 'rounded-control border-border focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary';

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

  const project = useProject(projectId);
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
    <RefButton variant="ghost" size="sm" onClick={onBack}>
      <ArrowLeft size={16} className="rtl:rotate-180" aria-hidden="true" />
      {t('report.backToList')}
    </RefButton>
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
            <RefButton variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
              {t('actions.retry')}
            </RefButton>
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

  const actionButtons = (editable || (dpr.status === 'SUBMITTED' && can('approve:progress'))) && (
    <div className="flex flex-wrap items-center gap-2">
      {editable ? (
        <RefButton onClick={() => submit.mutate()} disabled={submit.isPending} className="shadow-e1">
          <Send size={16} aria-hidden="true" />
          {t('actions.submit')}
        </RefButton>
      ) : null}
      {dpr.status === 'SUBMITTED' && can('approve:progress') ? (
        <>
          <RefButton variant="outline" onClick={() => setConfirm('return')}>
            <Undo2 size={16} aria-hidden="true" />
            {t('actions.return')}
          </RefButton>
          <RefButton onClick={() => setConfirm('approve')} disabled={!canApprove} className="shadow-e1">
            <Check size={16} aria-hidden="true" />
            {t('actions.approve')}
          </RefButton>
        </>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {backButton}
        <DprStatusBadge status={dpr.status} />
      </div>

      {dpr.status === 'SUBMITTED' && isSelfApprover && can('approve:progress') ? (
        <Alert variant="warning" messages={[t('report.selfApprovalBlocked')]} />
      ) : null}

      {/* Header */}
      <RefCard>
        <RefCardHeader
          title={t('report.title')}
          subtitle={formatDate(dpr.reportDate, locale)}
        />
        <RefCardBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <PersonCard
              label={t('report.fields.preparedBy')}
              name={dpr.preparedByName ?? dpr.preparedBy}
            />
            {dpr.submittedAt ? (
              <PersonCard
                label={t('report.fields.submittedAt')}
                name={formatDate(dpr.submittedAt, locale) ?? dpr.submittedAt}
                muted
              />
            ) : null}
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <ApprovalChain steps={chain} label={t('report.chain.label')} />
          </div>
          {isApproved ? (
            <p className="mt-3 text-body text-success">{t('report.approvedHint')}</p>
          ) : null}
          {/* Once the report is submitted/approved these become the permanent read record; while
              editable they live in the ReportDetailsCard below instead, so a value is never shown
              read-only and editable at the same time. */}
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {!editable && dpr.locationArea ? <Meta label={t('report.fields.locationArea')} value={dpr.locationArea} /> : null}
            {!editable && dpr.shift ? <Meta label={t('report.fields.shift')} value={dpr.shift} /> : null}
            {!editable && dpr.weather ? <Meta label={t('report.fields.weather')} value={dpr.weather} /> : null}
            {!editable && dpr.delayReason ? <Meta label={t('report.fields.delayReason')} value={dpr.delayReason} /> : null}
            {!editable && dpr.narrative ? (
              <div className="sm:col-span-2">
                <Meta label={t('report.fields.narrative')} value={dpr.narrative} />
              </div>
            ) : null}
            {dpr.returnReason ? (
              <div className="sm:col-span-2">
                <Meta label={t('report.fields.returnReason')} value={dpr.returnReason} />
              </div>
            ) : null}
          </dl>
        </RefCardBody>
      </RefCard>

      {editable ? (
        <ReportDetailsCard dpr={dpr} projectLocation={project.data?.location ?? undefined} />
      ) : null}

      {/* Measurements */}
      <RefCard>
        <RefCardHeader icon={<Ruler size={17} strokeWidth={1.9} />} title={t('measurement.title')} />
        <RefCardBody>
          {editable ? (
            <AddMeasurementForm dprId={dprId} projectId={projectId} leaves={leaves} />
          ) : null}
          {dpr.measurements.length === 0 ? (
            <p className="mt-3 text-body text-muted-foreground">{t('measurement.empty')}</p>
          ) : dpr.status === 'SUBMITTED' ? (
            <div className="mt-3 space-y-4">
              {dpr.measurements.map((m) => {
                const line = progressByNode.get(m.boqNodeId);
                const leaf = leafMap.get(m.boqNodeId);
                const priorVerified = Number(line?.verifiedToDate ?? 0);
                const today = Number(m.quantity);
                const cumulative = priorVerified + today;
                const scope = Number(line?.measurableQuantity ?? leaf?.quantity ?? 0);
                const exceeds = scope > 0 && cumulative > scope;
                const unit = leaf?.unit ? ` ${leaf.unit}` : '';
                return (
                  <div key={m.id} className="rounded-panel border border-border p-3">
                    <p className="text-body font-medium text-foreground">{leafLabel.get(m.boqNodeId) ?? m.boqNodeId}</p>
                    {m.locationArea ? (
                      <p className="mt-0.5 text-caption text-muted-foreground">{m.locationArea}</p>
                    ) : null}
                    <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <RefStatTile label={t('measurement.review.priorVerified')} value={`${formatNumber(priorVerified, locale, 3)}${unit}`} />
                      <RefStatTile label={t('measurement.review.today')} value={`${formatNumber(today, locale, 3)}${unit}`} />
                      <RefStatTile
                        label={t('measurement.review.cumulative')}
                        value={`${formatNumber(cumulative, locale, 3)}${unit}`}
                        tone={exceeds ? 'amber' : undefined}
                      />
                      <RefStatTile label={t('measurement.review.scope')} value={scope > 0 ? `${formatNumber(scope, locale, 3)}${unit}` : '—'} />
                    </div>
                    {exceeds ? (
                      <p className="mt-2 text-caption text-warning">{t('measurement.review.cumulativeExceedsScope')}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <RefTableScroll className="mt-3" aria-label={t('measurement.title')}>
              <RefTable>
                <RefThead>
                  <RefTr>
                    <RefTh>{t('measurement.boqNode')}</RefTh>
                    <RefTh numeric>{t('measurement.quantity')}</RefTh>
                    <RefTh>{t('measurement.locationArea')}</RefTh>
                    <RefTh>{t('measurement.notes')}</RefTh>
                  </RefTr>
                </RefThead>
                <RefTbody>
                  {dpr.measurements.map((m) => (
                    <RefTr key={m.id}>
                      <RefTd>{leafLabel.get(m.boqNodeId) ?? m.boqNodeId}</RefTd>
                      <RefTd numeric className="whitespace-nowrap tabular-nums">
                        {formatNumber(m.quantity, locale, 3)}
                      </RefTd>
                      <RefTd className="text-muted-foreground">{m.locationArea ?? '—'}</RefTd>
                      <RefTd className="text-muted-foreground">{m.notes ?? '—'}</RefTd>
                    </RefTr>
                  ))}
                </RefTbody>
              </RefTable>
            </RefTableScroll>
          )}
        </RefCardBody>
      </RefCard>

      {/* Evidence */}
      <DprEvidence
        dprId={dprId}
        canUpload={!isApproved}
        attachments={dpr.attachments}
        measurements={dpr.measurements}
        leafLabel={leafLabel}
      />

      {/* Section C — Labour & equipment */}
      <RefCard>
        <RefCardHeader icon={<HardHat size={17} strokeWidth={1.9} />} title={t('labour.title')} divider />
        <RefCardBody className="pt-4">
          <LabourSection dprId={dprId} rows={dpr.labourRows ?? []} editable={editable} />
        </RefCardBody>
        <div className="border-t border-border" />
        <RefCardHeader icon={<Wrench size={17} strokeWidth={1.9} />} title={t('equipment.title')} />
        <RefCardBody>
          <EquipmentSection dprId={dprId} rows={dpr.equipmentRows ?? []} editable={editable} />
        </RefCardBody>
      </RefCard>

      {/* Section D — Observations + tomorrow plan */}
      <RefCard>
        <RefCardHeader icon={<TriangleAlert size={17} strokeWidth={1.9} />} iconTone="amber" title={t('observations.title')} />
        <RefCardBody>
          <ObservationsSection dprId={dprId} rows={dpr.observations ?? []} editable={editable} />
        </RefCardBody>
      </RefCard>

      {dpr.tomorrowPlan ? (
        <RefCard>
          <RefCardHeader title={t('context.tomorrowPlan')} />
          <RefCardBody>
            <p className="text-body whitespace-pre-wrap text-foreground">{dpr.tomorrowPlan}</p>
          </RefCardBody>
        </RefCard>
      ) : null}

      {actionButtons ? (
        <div className="flex justify-end gap-2 rounded-container border border-border bg-surface px-5 py-4 shadow-e1">
          {actionButtons}
        </div>
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

/**
 * Weather, delay reason, labour/equipment headline counts, and the "work performed" narrative —
 * the context fields `PatchDprContextBody` already covers server-side (a genuinely built but,
 * before this, never-wired-up capability). Shown only while the report is DRAFT/RETURNED; once
 * submitted these read back as the plain `Meta` rows in the header instead.
 */
function ReportDetailsCard({
  dpr,
  projectLocation,
}: {
  dpr: DailyProgressReportDetail;
  projectLocation?: string;
}) {
  const t = useTranslations('progress');
  const { toast } = useToast();
  const patch = usePatchDprContext(dpr.id);

  // locationArea pre-fills from the DPR if previously saved, then falls back to the project
  // address so the SE doesn't have to type it every day on a single-site project.
  const [locationArea, setLocationArea] = useState(dpr.locationArea ?? projectLocation ?? '');
  const [shift, setShift] = useState(dpr.shift ?? '');
  const [weather, setWeather] = useState(dpr.weather ?? WEATHER_OPTIONS[0]);
  const [delayReason, setDelayReason] = useState(dpr.delayReason ?? DELAY_OPTIONS[0]);
  const [narrative, setNarrative] = useState(dpr.narrative ?? '');
  const [error, setError] = useState<string | null>(null);

  function onSave(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    patch.mutate(
      {
        locationArea: locationArea.trim() || undefined,
        shift: shift || undefined,
        weather,
        delayReason,
        narrative: narrative.trim() || undefined,
      },
      {
        onSuccess: () => toast({ tone: 'success', title: t('report.detailsSaved') }),
        onError: (e) => setError(e instanceof ApiError ? e.message : t('states.loadFailed')),
      },
    );
  }

  return (
    <RefCard>
      <RefCardHeader title={t('report.detailsTitle')} divider />
      <RefCardBody className="pt-4">
        <form onSubmit={onSave}>
          {error ? (
            <div className="mb-3">
              <Alert variant="error" messages={[error]} />
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField htmlFor="rd-location" label={t('context.locationArea')}>
              <Input
                id="rd-location"
                value={locationArea}
                onChange={(e) => setLocationArea(e.target.value)}
                placeholder={projectLocation ?? ''}
                className={refFieldClass}
              />
            </FormField>
            <FormField htmlFor="rd-shift" label={t('context.shift')}>
              <Select id="rd-shift" value={shift} onChange={setShift} className={refFieldClass}>
                <option value="">—</option>
                {SHIFT_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {t(`context.shifts.${s}` as Parameters<typeof t>[0])}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField htmlFor="rd-weather" label={t('report.fields.weather')}>
              <Select id="rd-weather" value={weather} onChange={setWeather} className={refFieldClass}>
                {WEATHER_OPTIONS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField htmlFor="rd-delay" label={t('report.fields.delayReason')}>
              <Select id="rd-delay" value={delayReason} onChange={setDelayReason} className={refFieldClass}>
                {DELAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="sm:col-span-2">
              <FormField htmlFor="rd-narrative" label={t('report.fields.narrative')}>
                <Textarea
                  id="rd-narrative"
                  value={narrative}
                  onChange={(e) => setNarrative(e.target.value)}
                  rows={3}
                  className={refFieldClass}
                />
              </FormField>
            </div>
          </div>
          <div className="mt-4">
            <RefButton type="submit" size="sm" disabled={patch.isPending}>
              {patch.isPending ? t('report.detailsSaving') : t('actions.save')}
            </RefButton>
          </div>
        </form>
      </RefCardBody>
    </RefCard>
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

function PersonCard({ label, name, muted }: { label: string; name: string; muted?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-panel border border-border p-3">
      <Avatar name={name} />
      <div className="min-w-0">
        <p className="text-caption text-muted-foreground">{label}</p>
        <p className={`truncate text-body font-medium ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>{name}</p>
      </div>
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
  const [locationArea, setLocationArea] = useState('');
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
      {
        boqNodeId,
        quantity: Number(quantity),
        notes: notes.trim() || undefined,
        locationArea: locationArea.trim() || undefined,
      },
      {
        onSuccess: () => {
          setBoqNodeId('');
          setQuantity('');
          setNotes('');
          setLocationArea('');
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
      <FormField htmlFor="m-location" label={t('measurement.locationArea')}>
        <Input
          id="m-location"
          value={locationArea}
          onChange={(e) => setLocationArea(e.target.value)}
          placeholder={t('measurement.locationAreaPlaceholder')}
        />
      </FormField>
      <div className="sm:col-span-2">
        <RefButton type="submit" disabled={add.isPending || !boqNodeId}>
          {t('measurement.add')}
        </RefButton>
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
  measurements,
  leafLabel,
}: {
  dprId: string;
  canUpload: boolean;
  attachments: Array<{ id: string; platformFileId: string; measurementId?: string }>;
  measurements: ProgressMeasurementResponse[];
  leafLabel: Map<string, string>;
}) {
  const t = useTranslations('progress');
  const upload = useFileUpload();
  const attach = useAttachDprEvidence(dprId);
  const [tagTo, setTagTo] = useState('');

  // Which work entry the evidence supports, not just that it exists on the report — the same
  // label used on the measurement rows above, so a photo tag reads consistently everywhere.
  const measurementLabel = useMemo(
    () => new Map(measurements.map((m) => [m.id, leafLabel.get(m.boqNodeId) ?? m.boqNodeId])),
    [measurements, leafLabel],
  );

  const onUpload = async (file: File) => {
    const fileId = await upload.mutateAsync(file);
    await attach.mutateAsync({ platformFileId: fileId, measurementId: tagTo || undefined });
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
    <RefCard>
      <RefCardHeader icon={<ImageIcon size={17} strokeWidth={1.9} />} iconTone="violet" title={t('evidence.title')} subtitle={t('evidence.hint')} />
      <RefCardBody>
        {canUpload ? (
          <div className="mt-1">
            {measurements.length > 0 ? (
              <div className="mb-3">
                <FormField htmlFor="ev-tag" label={t('evidence.tagLabel')}>
                  <Select id="ev-tag" value={tagTo} onChange={setTagTo} className={refFieldClass}>
                    <option value="">{t('evidence.tagWholeReport')}</option>
                    {measurements.map((m) => (
                      <option key={m.id} value={m.id}>
                        {measurementLabel.get(m.id)}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
            ) : null}
            <MediaUpload onUpload={onUpload} labels={labels} />
          </div>
        ) : null}
        {attachments.length === 0 ? (
          <p className="mt-3 text-body text-muted-foreground">{t('evidence.empty')}</p>
        ) : (
          <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
            {attachments.map((a, index) => (
              <EvidenceTile
                key={a.id}
                platformFileId={a.platformFileId}
                index={index}
                tagLabel={a.measurementId ? measurementLabel.get(a.measurementId) : undefined}
              />
            ))}
          </ul>
        )}
      </RefCardBody>
    </RefCard>
  );
}

function EvidenceTile({
  platformFileId,
  index,
  tagLabel,
}: {
  platformFileId: string;
  index: number;
  tagLabel?: string;
}) {
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
    return <li className="aspect-square animate-pulse rounded-panel bg-muted" aria-hidden="true" />;
  }
  if (query.isError || !query.data) {
    return (
      <li className="flex aspect-square items-center justify-center rounded-panel border border-border bg-surface px-2 text-center text-caption text-muted-foreground">
        {t('evidence.unavailable')}
      </li>
    );
  }

  const { url, originalName, mimeType } = query.data;
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');

  return (
    <li className="relative aspect-square overflow-hidden rounded-panel border border-border bg-muted">
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
        {tagLabel ? (
          <span
            className="absolute start-1.5 top-1.5 max-w-[65%] truncate rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white"
            title={tagLabel}
          >
            {tagLabel}
          </span>
        ) : null}
        <span
          aria-hidden="true"
          className="absolute end-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[11px] font-medium text-white"
        >
          {index + 1}
        </span>
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
  const locale = useLocale() as 'en' | 'ar';
  const add = useAddLabourRow(dprId);
  const remove = useRemoveLabourRow(dprId);
  const suppliers = useSuppliers({ status: 'ACTIVE' });

  const [trade, setTrade] = useState('');
  const [headcount, setHeadcount] = useState('');
  // Default to direct labour; SE only changes it for subcontracted trades.
  const [contractor, setContractor] = useState(t('labour.fields.contractorDefault'));
  const [hours, setHours] = useState('');
  const [error, setError] = useState<string | null>(null);

  const contractorOptions = useMemo(
    () => [
      t('labour.fields.contractorDefault'),
      ...(suppliers.data?.map((s) => s.name) ?? []),
    ],
    [suppliers.data, t],
  );

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!trade.trim() || !(Number(headcount) >= 0)) return;
    setError(null);
    add.mutate(
      {
        trade: trade.trim(),
        headcount: Number(headcount),
        contractor: contractor || undefined,
        hours: hours ? Number(hours) : undefined,
      },
      {
        onSuccess: () => {
          setTrade('');
          setHeadcount('');
          setContractor(t('labour.fields.contractorDefault'));
          setHours('');
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : t('states.loadFailed')),
      },
    );
  }

  return (
    <div>
      {rows.length > 0 ? (
        <RefTableScroll aria-label={t('labour.title')}>
          <RefTable>
            <RefThead>
              <RefTr>
                <RefTh>{t('labour.fields.trade')}</RefTh>
                <RefTh numeric>{t('labour.fields.headcount')}</RefTh>
                <RefTh>{t('labour.fields.contractor')}</RefTh>
                <RefTh numeric>{t('labour.fields.hours')}</RefTh>
                {editable ? <RefTh /> : null}
              </RefTr>
            </RefThead>
            <RefTbody>
              {rows.map((row) => {
                const manHours =
                  row.hours != null ? row.headcount * Number(row.hours) : null;
                return (
                  <RefTr key={row.id}>
                    <RefTd className="font-medium">{row.trade}</RefTd>
                    <RefTd numeric className="tabular-nums">{row.headcount}</RefTd>
                    <RefTd className="text-muted-foreground">{row.contractor ?? '—'}</RefTd>
                    <RefTd numeric className="tabular-nums text-muted-foreground">
                      {row.hours != null ? (
                        <>
                          <div>{formatNumber(Number(row.hours), locale, 1)}</div>
                          <div className="text-caption text-disabled-foreground">
                            {formatNumber(manHours!, locale, 0)} {t('labour.fields.manHours')}
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </RefTd>
                    {editable ? (
                      <RefTd>
                        <RefButton
                          variant="ghost"
                          size="sm"
                          aria-label={t('labour.remove')}
                          onClick={() => remove.mutate(row.id)}
                          disabled={remove.isPending}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </RefButton>
                      </RefTd>
                    ) : null}
                  </RefTr>
                );
              })}
            </RefTbody>
          </RefTable>
        </RefTableScroll>
      ) : (
        <p className="text-body text-muted-foreground">{t('labour.empty')}</p>
      )}
      {editable ? (
        <form onSubmit={onAdd} className="mt-3 grid gap-2 sm:grid-cols-4" aria-label={t('labour.add')}>
          {error ? (
            <div className="sm:col-span-4">
              <Alert variant="error" messages={[error]} />
            </div>
          ) : null}
          <FormField htmlFor="lr-trade" label={t('labour.fields.trade')}>
            <Select id="lr-trade" value={trade} onChange={setTrade} className={refFieldClass}>
              <option value="">{t('labour.tradeChoose')}</option>
              {TRADE_OPTIONS.map((tr) => (
                <option key={tr} value={tr}>
                  {tr}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField htmlFor="lr-count" label={t('labour.fields.headcount')}>
            <Input id="lr-count" type="number" min="0" value={headcount} onChange={(e) => setHeadcount(e.target.value)} className={refFieldClass} />
          </FormField>
          <FormField htmlFor="lr-contractor" label={t('labour.fields.contractor')}>
            <Select
              id="lr-contractor"
              value={contractor}
              onChange={setContractor}
              className={refFieldClass}
              disabled={suppliers.isPending}
            >
              {contractorOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField htmlFor="lr-hours" label={t('labour.fields.hours')}>
            <Input id="lr-hours" type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} className={refFieldClass} />
          </FormField>
          <div className="sm:col-span-4">
            <RefButton type="submit" size="sm" disabled={add.isPending || !trade.trim()}>
              {add.isPending ? t('labour.saving') : t('labour.add')}
            </RefButton>
          </div>
        </form>
      ) : null}
    </div>
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

  // Custom types entered this session — persists within the component lifetime so previously
  // added custom types reappear in the dropdown without requiring a backend round-trip.
  const [sessionCustomTypes, setSessionCustomTypes] = useState<string[]>([]);
  const [equipQuery, setEquipQuery] = useState('');
  const [equipType, setEquipType] = useState('');
  const [count, setCount] = useState('');
  const [hoursWorked, setHoursWorked] = useState('');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Extract any custom types already stored on this DPR's rows (e.g. from a prior session).
  const persistedCustomTypes = useMemo(
    () => rows.map((r) => r.equipmentType).filter((ty) => !EQUIPMENT_TYPE_OPTIONS.includes(ty)),
    [rows],
  );
  const allCustomTypes = useMemo(
    () => Array.from(new Set([...persistedCustomTypes, ...sessionCustomTypes])),
    [persistedCustomTypes, sessionCustomTypes],
  );
  const equipOptions = useMemo(
    () => [
      ...allCustomTypes.map((ty) => ({ value: ty, label: ty, group: 'Custom' })),
      ...EQUIPMENT_TYPE_OPTIONS.map((e) => ({ value: e, label: e })),
    ],
    [allCustomTypes],
  );

  // Footer action: shown when the user types something not in the options list, letting them add a
  // custom type without a dedicated DB table (org-wide persistence is backend-blocked, Q1).
  const footerAction = useMemo(() => {
    const q = equipQuery.trim();
    if (!q) return undefined;
    const already = equipOptions.some((o) => o.label.toLowerCase() === q.toLowerCase());
    if (already) return undefined;
    return {
      label: `Use "${q}"`,
      onSelect: () => {
        setEquipType(q);
        setSessionCustomTypes((prev) => (prev.includes(q) ? prev : [...prev, q]));
        setEquipQuery('');
      },
    };
  }, [equipQuery, equipOptions]);

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
    <div>
      {rows.length > 0 ? (
        <RefTableScroll aria-label={t('equipment.title')}>
          <RefTable>
            <RefThead>
              <RefTr>
                <RefTh>{t('equipment.fields.type')}</RefTh>
                <RefTh numeric>{t('equipment.fields.count')}</RefTh>
                <RefTh numeric>{t('equipment.fields.hours')}</RefTh>
                <RefTh>{t('equipment.fields.condition')}</RefTh>
                {editable ? <RefTh /> : null}
              </RefTr>
            </RefThead>
            <RefTbody>
              {rows.map((row) => (
                <RefTr key={row.id}>
                  <RefTd className="font-medium">{row.equipmentType}</RefTd>
                  <RefTd numeric className="tabular-nums">{row.count}</RefTd>
                  <RefTd numeric className="tabular-nums text-muted-foreground">
                    {row.hoursWorked ?? '—'}
                  </RefTd>
                  <RefTd className="text-muted-foreground">{row.condition ?? '—'}</RefTd>
                  {editable ? (
                    <RefTd>
                      <RefButton
                        variant="ghost"
                        size="sm"
                        aria-label={t('equipment.remove')}
                        onClick={() => remove.mutate(row.id)}
                        disabled={remove.isPending}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </RefButton>
                    </RefTd>
                  ) : null}
                </RefTr>
              ))}
            </RefTbody>
          </RefTable>
        </RefTableScroll>
      ) : (
        <p className="text-body text-muted-foreground">{t('equipment.empty')}</p>
      )}
      {editable ? (
        <form onSubmit={onAdd} className="mt-3 grid gap-2 sm:grid-cols-3" aria-label={t('equipment.add')}>
          {error ? (
            <div className="sm:col-span-3">
              <Alert variant="error" messages={[error]} />
            </div>
          ) : null}
          <FormField htmlFor="eq-type" label={t('equipment.fields.type')}>
            <Combobox
              id="eq-type"
              value={equipType}
              onChange={setEquipType}
              options={equipOptions}
              placeholder={t('equipment.typeChoose')}
              searchPlaceholder={t('equipment.typeSearch')}
              emptyLabel={t('equipment.typeEmpty')}
              onQueryChange={setEquipQuery}
              footerAction={footerAction}
            />
          </FormField>
          <FormField htmlFor="eq-count" label={t('equipment.fields.count')}>
            <Input id="eq-count" type="number" min="0" value={count} onChange={(e) => setCount(e.target.value)} className={refFieldClass} />
          </FormField>
          <FormField htmlFor="eq-hours" label={t('equipment.fields.hours')}>
            <Input id="eq-hours" type="number" min="0" step="0.5" value={hoursWorked} onChange={(e) => setHoursWorked(e.target.value)} className={refFieldClass} />
          </FormField>
          <FormField htmlFor="eq-condition" label={t('equipment.fields.condition')}>
            <Select id="eq-condition" value={condition} onChange={(value) => setCondition(value)} className={refFieldClass}>
              <option value="">—</option>
              {EQUIPMENT_CONDITIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </FormField>
          <div className="sm:col-span-2">
            <FormField htmlFor="eq-notes" label={t('equipment.fields.notes')}>
              <Input id="eq-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={refFieldClass} />
            </FormField>
          </div>
          <div className="sm:col-span-3">
            <RefButton type="submit" size="sm" disabled={add.isPending || !equipType.trim()}>
              {add.isPending ? t('equipment.saving') : t('equipment.add')}
            </RefButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}

// ─── Section D: Observations ─────────────────────────────────────────────────────────────

const OBS_CATEGORIES = ['ISSUE', 'DELAY', 'SAFETY'] as const;
type ObsCategory = (typeof OBS_CATEGORIES)[number];

const SEVERITY_OPTIONS = ['low', 'medium', 'high'] as const;

const OBS_TONES: Record<ObsCategory, RefTone> = {
  ISSUE: 'amber',
  DELAY: 'amber',
  SAFETY: 'red',
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
    <div>
      {rows.length > 0 ? (
        <ul className="divide-y divide-border">
          {rows.map((obs) => (
            <li key={obs.id} className="flex items-start gap-3 py-3">
              <RefPill tone={OBS_TONES[obs.category as ObsCategory] ?? 'blue'} className="mt-0.5 shrink-0">
                {t(`observations.categories.${obs.category}`)}
              </RefPill>
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium text-foreground">{obs.description}</p>
                {obs.affectedWork ? (
                  <p className="mt-0.5 text-caption text-muted-foreground">{obs.affectedWork}</p>
                ) : null}
                {obs.severity ? (
                  <p className="mt-0.5 text-caption text-muted-foreground capitalize">{obs.severity}</p>
                ) : null}
                {obs.followUpOwner ? (
                  <p className="mt-0.5 text-caption text-muted-foreground">→ {obs.followUpOwner}</p>
                ) : null}
              </div>
              {editable ? (
                <RefButton
                  variant="ghost"
                  size="sm"
                  aria-label={t('observations.remove')}
                  onClick={() => remove.mutate(obs.id)}
                  disabled={remove.isPending}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </RefButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">{t('observations.empty')}</p>
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
            <RefButton type="submit" size="sm" disabled={add.isPending || !description.trim()}>
              {add.isPending ? t('observations.saving') : t('observations.add')}
            </RefButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function errText(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.messages.length > 0 ? error.messages[0]! : fallback;
}
