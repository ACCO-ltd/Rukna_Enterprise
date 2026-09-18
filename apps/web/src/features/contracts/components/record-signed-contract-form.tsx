'use client';

import { useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Paperclip, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DatePicker,
  FormField,
  FormSection,
  Input,
  MoneyInput,
  Textarea,
} from '@erp/ui';

import { useBoqWorkspace } from '@/features/boq/hooks/use-boq';
import { useClients } from '@/features/clients/hooks/use-clients';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { FormActions } from '@/components/form-actions';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import {
  buildPaymentPlan,
  paymentPlanTotalPercent,
  type PaymentPlanRow,
} from '../contract-form-payload';
import { ACCO_STANDARD_PLAN } from './payment-plan-fields';
import { PaymentPlanBuilder } from './payment-plan-builder';
import { BillingModel } from '../types';
import { useRecordSignedContract } from '../hooks/use-record-signed-contract';

interface RecordSignedContractFields {
  contractNumber: string;
  signedDate: string;
  contractValue: string;
  startDate: string;
  expectedEndDate: string;
  paymentTerms: string;
  paymentPlan: PaymentPlanRow[];
}

/**
 * Record a physically-signed contract.
 *
 * ACCO and the client already signed on paper; this form records that agreement in the ERP.
 * It is not an electronic-signing workflow — "signed date" is when the paper was signed,
 * "signed value" is what the parties agreed, and the BOQ snapshot is preserved as the
 * reference scope without exposing any version IDs or lifecycle enums.
 *
 * Submission is atomic from the user's perspective: if a signed document was attached it is
 * uploaded first, then the contract is created AND activated in one call. The DRAFT state
 * and the separate activate step are implementation details kept out of the user journey.
 */
export function RecordSignedContractForm({ projectId }: { projectId: string }) {
  const t = useTranslations('platform.contracts.record');
  const tCreate = useTranslations('platform.contracts.create');
  const tCommon = useTranslations('common');

  const record = useRecordSignedContract(projectId);
  const projects = useProjects();
  const clients = useClients();
  const boq = useBoqWorkspace(projectId);

  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  const project = (projects.data ?? []).find((p) => p.id === projectId) ?? null;
  const clientId = project?.clientId ?? '';
  const clientName = clients.data?.find((c) => c.id === clientId)?.name ?? null;

  // Schema defined inside the component so superRefine has access to `t` for translated messages,
  // following the same pattern as contract-create-form.tsx.
  const schema = z
    .object({
      contractNumber: z.string().max(50),
      signedDate: z.string().min(1),
      contractValue: z
        .string()
        .min(1)
        .refine(
          (v) => /^\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v.trim()) >= 0,
          t('valueInvalid'),
        ),
      startDate: z.string(),
      expectedEndDate: z.string(),
      paymentTerms: z.string(),
      paymentPlan: z.array(
        z.object({
          name: z.string(),
          percentage: z.string(),
          isAdvance: z.boolean(),
          dueDate: z.string(),
        }),
      ),
    })
    .superRefine((values, ctx) => {
      if (
        values.startDate &&
        values.expectedEndDate &&
        values.expectedEndDate < values.startDate
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expectedEndDate'],
          message: t('endBeforeStart'),
        });
      }
      if (values.paymentPlan.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentPlan'],
          message: tCreate('plan.empty'),
        });
        return;
      }
      values.paymentPlan.forEach((row, i) => {
        if (!row.name.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['paymentPlan', i, 'name'],
            message: tCreate('plan.nameRequired'),
          });
        }
        const pct = row.percentage.trim();
        if (!/^\d+(\.\d{1,2})?$/.test(pct) || Number(pct) <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['paymentPlan', i, 'percentage'],
            message: tCreate('plan.percentInvalid'),
          });
        }
      });
      const total = paymentPlanTotalPercent(values.paymentPlan);
      if (Math.abs(total - 100) > 0.001) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentPlan'],
          message: tCreate('plan.totalMismatch', { total }),
        });
      }
    });

  const {
    control,
    register,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<RecordSignedContractFields>({
    resolver: zodResolver(schema),
    defaultValues: {
      contractNumber: '',
      signedDate: '',
      contractValue: '',
      startDate: '',
      expectedEndDate: '',
      paymentTerms: '',
      paymentPlan: ACCO_STANDARD_PLAN.map((row) => ({ ...row })),
    },
  });

  const watched = useWatch({ control });
  // useWatch returns deeply-partial types; cast to the form's actual runtime shape.
  const planRows = (watched.paymentPlan ?? []) as PaymentPlanRow[];
  const planBalanced =
    planRows.length > 0 && Math.abs(100 - paymentPlanTotalPercent(planRows)) <= 0.001;

  const dataPending = projects.isPending || clients.isPending || boq.isPending;
  const dataFailed = projects.isError || clients.isError || boq.isError;

  if (dataPending) {
    return (
      <div
        className="h-72 animate-pulse rounded-panel border border-border bg-muted"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">{tCommon('loading')}</span>
      </div>
    );
  }

  if (dataFailed) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }

  // Already translated by superRefine — just read the message string directly.
  const planError =
    typeof errors.paymentPlan?.message === 'string' ? errors.paymentPlan.message : undefined;

  const errorMessages = record.error
    ? [
        record.error instanceof ApiError && record.error.messages.length > 0
          ? record.error.message
          : t('failed'),
      ]
    : [];

  const onSubmit = (values: RecordSignedContractFields) => {
    if (record.isPending || !clientId || !planBalanced) return;
    record.mutate({
      projectId,
      clientId,
      contractNumber: values.contractNumber.trim() || undefined,
      signedDate: values.signedDate,
      contractValue: values.contractValue,
      billingModel: BillingModel.MILESTONE,
      paymentTerms: values.paymentTerms.trim() || undefined,
      startDate: values.startDate.trim() || undefined,
      expectedEndDate: values.expectedEndDate.trim() || undefined,
      paymentPlan: buildPaymentPlan(values.paymentPlan),
      file: file ?? undefined,
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      {/* ── Left: form ───────────────────────────────────────────────────── */}
      <form
        onSubmit={(e) => {
          void handleSubmit(onSubmit)(e);
        }}
        className="space-y-7"
        noValidate
      >
        {errorMessages.length > 0 ? <Alert variant="error" messages={errorMessages} /> : null}

        {/* Contract terms */}
        <FormSection variant="plain" title={t('termsSection')}>
          {/* Client — read-only, inherited from project */}
          <FormField htmlFor="record-client" label={t('client')}>
            <p
              id="record-client"
              className="flex h-10 items-center text-body-sm text-foreground"
            >
              {clientName ?? <span className="italic text-muted-foreground">—</span>}
            </p>
          </FormField>

          <FormField
            htmlFor="record-number"
            label={t('contractReference')}
            error={errors.contractNumber?.message}
          >
            <Input
              id="record-number"
              {...register('contractNumber')}
              placeholder={t('contractReferencePlaceholder')}
            />
          </FormField>

          <FormField
            htmlFor="record-signed-date"
            label={t('signedDate')}
            error={errors.signedDate?.message ? t('signedDateRequired') : undefined}
            required
          >
            <Controller
              control={control}
              name="signedDate"
              render={({ field }) => (
                <DatePicker
                  id="record-signed-date"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </FormField>

          <FormField
            htmlFor="record-value"
            label={t('contractValue')}
            error={errors.contractValue?.message}
            required
          >
            <Controller
              control={control}
              name="contractValue"
              render={({ field }) => (
                <MoneyInput
                  id="record-value"
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder="0.00"
                />
              )}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField htmlFor="record-start" label={t('startDate')}>
              <Controller
                control={control}
                name="startDate"
                render={({ field }) => (
                  <DatePicker id="record-start" value={field.value} onChange={field.onChange} />
                )}
              />
            </FormField>
            <FormField
              htmlFor="record-end"
              label={t('endDate')}
              error={errors.expectedEndDate?.message}
            >
              <Controller
                control={control}
                name="expectedEndDate"
                render={({ field }) => (
                  <DatePicker id="record-end" value={field.value} onChange={field.onChange} />
                )}
              />
            </FormField>
          </div>

          <FormField htmlFor="record-terms" label={t('paymentTerms')}>
            <Controller
              control={control}
              name="paymentTerms"
              render={({ field }) => (
                <Textarea
                  id="record-terms"
                  value={field.value}
                  onChange={field.onChange}
                  rows={2}
                  placeholder={t('paymentTermsPlaceholder')}
                />
              )}
            />
          </FormField>
        </FormSection>

        {/* Milestone payment schedule */}
        <FormSection variant="plain" title={t('plan.title')}>
          <p className="text-xs text-muted-foreground">{t('plan.subtitle')}</p>
          {planError ? (
            <div className="mt-3">
              <Alert variant="error" messages={[planError]} />
            </div>
          ) : null}
          <div className="mt-3">
            <PaymentPlanBuilder
              control={control as never}
              register={register as never}
              setValue={setValue as never}
              errors={errors as never}
              t={tCreate}
              contractValue={watched.contractValue ?? null}
              currency="USD"
              locale="en"
              targetPercent={100}
              allowAdvance
              showAccoStandard
            />
          </div>
        </FormSection>

        {/* Signed document upload */}
        <FormSection variant="plain" title={t('signedDocument')}>
          <p className="text-xs text-muted-foreground">{t('signedDocumentHint')}</p>
          <div className="mt-3">
            {file ? (
              <div className="flex items-center justify-between rounded-control border border-border bg-muted/30 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Paperclip
                    size={15}
                    className="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="truncate text-body-sm text-foreground">{file.name}</span>
                  <span className="shrink-0 text-caption text-muted-foreground">
                    — {(file.size / 1024).toFixed(0)} KB
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                  }}
                  className="ml-3 inline-flex min-h-8 shrink-0 items-center gap-1 rounded-control px-2 text-caption font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
                >
                  <X size={14} aria-hidden="true" />
                  {t('signedDocumentClear')}
                </button>
              </div>
            ) : (
              <label
                htmlFor="record-file"
                className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-panel border border-dashed border-border px-4 py-5 text-center transition-colors hover:border-foreground/30 hover:bg-muted/20"
              >
                <Paperclip size={18} className="text-muted-foreground" aria-hidden="true" />
                <span className="text-body-sm text-muted-foreground">
                  {t('signedDocumentDrop')}
                </span>
                <span className="text-caption text-muted-foreground/70">
                  {t('signedDocumentFormats')}
                </span>
              </label>
            )}
            <input
              ref={fileInput}
              id="record-file"
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              onChange={(e) => {
                const picked = e.target.files?.[0] ?? null;
                setFile(picked);
                // reset so the same file can be re-selected after clearing
                e.target.value = '';
              }}
            />
          </div>
        </FormSection>

        <FormActions
          isPending={record.isPending}
          disabled={!clientId || !planBalanced}
          submitLabel={t('submit')}
          cancelLabel={t('cancel')}
          cancelHref={`/projects/${projectId}/commercial/contract-security`}
        />
      </form>

      {/* ── Right: live summary panel ─────────────────────────────────────── */}
      <aside className="lg:sticky lg:top-8 lg:self-start">
        <RecordPreviewPanel
          projectName={project?.name ?? projectId}
          clientName={clientName}
          contractNumber={watched.contractNumber}
          contractValue={watched.contractValue}
          signedDate={watched.signedDate}
          planRows={planRows}
          fileName={file?.name ?? null}
          t={t}
        />
      </aside>
    </div>
  );
}

// ─── Live preview panel ───────────────────────────────────────────────────────

function RecordPreviewPanel({
  projectName,
  clientName,
  contractNumber,
  contractValue,
  signedDate,
  planRows,
  fileName,
  t,
}: {
  projectName: string;
  clientName: string | null;
  contractNumber: string | undefined;
  contractValue: string | undefined;
  signedDate: string | undefined;
  planRows: PaymentPlanRow[];
  fileName: string | null;
  t: ReturnType<typeof useTranslations<'platform.contracts.record'>>;
}) {
  const numberLabel = contractNumber?.trim() ? contractNumber.trim() : t('summaryReferenceAuto');
  const valueLabel = contractValue?.trim()
    ? (formatMoney(contractValue.trim(), 'USD', 'en') ?? '—')
    : '—';
  const dateLabel = signedDate ? (formatDate(signedDate, 'en') ?? '—') : '—';

  return (
    <div className="rounded-panel border border-border bg-surface p-4">
      {/* Project + client header */}
      <div className="border-b border-border pb-4">
        <p className="text-body-sm font-semibold text-foreground">{projectName}</p>
        <p className="mt-0.5 text-caption text-muted-foreground">{clientName ?? '—'}</p>
      </div>

      {/* Key facts */}
      <dl className="mt-3">
        <PreviewRow label={t('summaryReference')} muted={!contractNumber?.trim()}>
          {numberLabel}
        </PreviewRow>
        <PreviewRow label={t('summaryValue')} muted={!contractValue?.trim()}>
          {valueLabel}
        </PreviewRow>
        <PreviewRow label={t('summarySignedDate')} muted={!signedDate}>
          {dateLabel}
        </PreviewRow>
      </dl>

      {/* Milestone schedule */}
      {planRows.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            {t('summaryMilestones')}
          </p>
          {planRows.map((row, i) => (
            <div
              key={i}
              className="flex items-baseline justify-between gap-2 py-1 text-body-sm"
            >
              <span className="min-w-0 truncate text-foreground">{row.name || '—'}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {row.percentage || '0'}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Document */}
      <div className="mt-4 border-t border-border pt-4">
        <PreviewRow label={t('summaryDocument')} muted={!fileName}>
          {fileName ?? t('summaryDocumentNone')}
        </PreviewRow>
      </div>

      {/* BOQ snapshot note */}
      <div className="mt-4 border-t border-border pt-4">
        <Alert variant="info" messages={[t('boqSnapshotNote')]} />
      </div>
    </div>
  );
}

function PreviewRow({
  label,
  children,
  muted = false,
}: {
  label: string;
  children: string;
  muted?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(6rem,0.9fr)_minmax(0,1.1fr)] gap-2 border-b border-border/60 py-2 last:border-b-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd
        className={`text-end text-body-sm tabular-nums ${
          muted ? 'italic text-muted-foreground' : 'font-medium text-foreground'
        }`}
      >
        {children}
      </dd>
    </div>
  );
}
