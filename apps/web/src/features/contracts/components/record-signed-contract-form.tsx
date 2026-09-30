'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  FileDrop,
  FormActionBar,
  FormField,
  FormGroup,
  Input,
  LineItemsEditor,
  MoneyInput,
  Select,
  SummaryRail,
  type LineColumn,
} from '@erp/ui';

import { FormErrorSummary, type FormFieldError } from '@/components/form-error-summary';
import { useBoqWorkspace } from '@/features/boq/hooks/use-boq';
import { useClients } from '@/features/clients/hooks/use-clients';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';

import {
  buildPaymentPlan,
  installmentAmount,
  paymentPlanTotalPercent,
  type PaymentPlanBilledOn,
  type PaymentPlanRow,
} from '../contract-form-payload';
import { ACCO_STANDARD_PLAN } from './payment-plan-fields';
import { BillingModel } from '../types';
import { useRecordSignedContract } from '../hooks/use-record-signed-contract';

const PAYMENT_TERMS = ['DUE_ON_RECEIPT', 'NET_7', 'NET_14', 'NET_30', 'NET_45', 'NET_60'] as const;
type PaymentTermsKey = (typeof PAYMENT_TERMS)[number];

interface Fields {
  contractNumber: string;
  signedDate: string;
  contractValue: string;
  startDate: string;
  expectedEndDate: string;
  paymentTerms: PaymentTermsKey;
}

type StageRow = PaymentPlanRow & { key: number; billedOn: PaymentPlanBilledOn };

let nextKey = 0;
const stageFromTemplate = (row: PaymentPlanRow): StageRow => ({
  ...row,
  key: nextKey++,
  billedOn: row.isAdvance ? 'ADVANCE' : 'MILESTONE',
});

/**
 * Record a physically signed contract (ACCO signs on paper; this records the agreement).
 *
 * One page, three sections — the contract, how it bills, the signed agreement — beside a rail
 * that says exactly what recording will create. Recording is one command
 * (`POST /contracts/record-signed`): the contract becomes Active, the current BOQ is kept as the
 * signed scope, and the advance becomes billable at once. Because that cannot be taken back
 * without a reopen, a confirmation names the value, the BOQ version and the advance first.
 */
export function RecordSignedContractForm({ projectId }: { projectId: string }) {
  const t = useTranslations('platform.contracts.record');
  const tCommon = useTranslations('common');

  const record = useRecordSignedContract(projectId);
  const projects = useProjects();
  const clients = useClients();
  const boq = useBoqWorkspace(projectId);

  const [fields, setFields] = useState<Fields>({
    contractNumber: '',
    signedDate: '',
    contractValue: '',
    startDate: '',
    expectedEndDate: '',
    paymentTerms: 'NET_30',
  });
  const [stages, setStages] = useState<StageRow[]>(() => ACCO_STANDARD_PLAN.map(stageFromTemplate));
  const [file, setFile] = useState<File | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const project = (projects.data ?? []).find((p) => p.id === projectId) ?? null;
  const clientId = project?.clientId ?? '';
  const clientName = clients.data?.find((c) => c.id === clientId)?.name ?? null;
  const boqVersion = boq.data?.draft?.versionNumber ?? boq.data?.approved?.versionNumber ?? null;

  if (projects.isPending || clients.isPending || boq.isPending) {
    return (
      <div className="h-72 animate-pulse rounded-panel border border-border bg-muted" role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
      </div>
    );
  }
  if (projects.isError || clients.isError || boq.isError) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((current) => ({ ...current, [key]: value }));
  const setStage = (index: number, patch: Partial<StageRow>) =>
    setStages((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const allocated = paymentPlanTotalPercent(stages);
  const money = (value: number | string | null) =>
    value === null || value === '' ? '—' : (formatMoney(String(value), 'USD', 'en') ?? '—');
  const advanceRow = stages.find((row) => row.billedOn === 'ADVANCE') ?? null;
  const advanceAmount = advanceRow ? installmentAmount(advanceRow.percentage, fields.contractValue || null) : null;

  // ─── Validation (every message in words, shown after the first submit) ─────
  const fieldErrors: Partial<Record<keyof Fields, string>> = {};
  if (!fields.signedDate) fieldErrors.signedDate = t('signedDateRequired');
  if (!/^\d+(\.\d{1,2})?$/.test(fields.contractValue.trim()) || Number(fields.contractValue) <= 0) {
    fieldErrors.contractValue = t('valueInvalid');
  }
  if (fields.startDate && fields.expectedEndDate && fields.expectedEndDate < fields.startDate) {
    fieldErrors.expectedEndDate = t('endBeforeStart');
  }
  const stageErrors = stages.map((row) => {
    const errors: Record<string, string> = {};
    if (!row.name.trim()) errors.name = t('schedule.nameRequired');
    if (!/^\d+(\.\d{1,2})?$/.test(row.percentage.trim()) || Number(row.percentage) <= 0) errors.percentage = t('schedule.percentInvalid');
    if (row.billedOn === 'DATE' && !row.dueDate) errors.dueDate = t('schedule.dateRequired');
    return errors;
  });
  const planErrors: string[] = [];
  if (stages.length === 0) planErrors.push(t('schedule.empty'));
  if (Math.abs(allocated - 100) > 0.001) planErrors.push(t('schedule.totalMismatch', { total: round(allocated) }));
  if (stages.filter((row) => row.billedOn === 'ADVANCE').length > 1) planErrors.push(t('schedule.oneAdvance'));
  if (!clientId) planErrors.push(t('noClient'));

  const summaryErrors: FormFieldError[] = [
    ...(Object.entries(fieldErrors).map(([key, message]) => ({ label: t(`labels.${key}`), fieldId: `record-${key}`, message: message! }))),
    ...stageErrors.flatMap((errors, index) =>
      Object.entries(errors).map(([key, message]) => ({
        label: t('schedule.stageField', { number: index + 1, field: t(`schedule.${key}`) }),
        fieldId: `stage-${index}-${key}`,
        message,
      })),
    ),
  ];
  const valid = summaryErrors.length === 0 && planErrors.length === 0;

  const submit = () => {
    setAttempted(true);
    if (valid) setConfirming(true);
  };

  const confirm = () => {
    record.mutate(
      {
        projectId,
        clientId,
        contractNumber: fields.contractNumber.trim() || undefined,
        signedDate: fields.signedDate,
        contractValue: fields.contractValue.trim(),
        billingModel: BillingModel.MILESTONE,
        paymentTerms: t(`terms.${fields.paymentTerms}`),
        startDate: fields.startDate || undefined,
        expectedEndDate: fields.expectedEndDate || undefined,
        paymentPlan: buildPaymentPlan(stages),
        file: file ?? undefined,
      },
      { onSettled: () => setConfirming(false) },
    );
  };

  const apiError = record.error
    ? record.error instanceof ApiError && record.error.messages.length > 0
      ? record.error.messages.join(' ')
      : t('failed')
    : null;

  const columns: LineColumn<StageRow>[] = [
    {
      key: 'name',
      header: t('schedule.name'),
      required: true,
      width: 'minmax(0,2fr)',
      controlId: (i) => `stage-${i}-name`,
      cell: (row, i) => (
        <Input id={`stage-${i}-name`} value={row.name} aria-invalid={Boolean(attempted && stageErrors[i]?.name)} onChange={(e) => setStage(i, { name: e.target.value })} />
      ),
    },
    {
      key: 'billedOn',
      header: t('schedule.billedOn'),
      width: '9rem',
      controlId: (i) => `stage-${i}-billedOn`,
      // A due date means something only for a Date stage (the others bill on an event), so it
      // opens under the choice instead of taking a column of dashes.
      cell: (row, i) => (
        <div className="space-y-2">
          <Select
            id={`stage-${i}-billedOn`}
            searchable={false}
            value={row.billedOn}
            onChange={(value) => setStage(i, { billedOn: value as PaymentPlanBilledOn, isAdvance: value === 'ADVANCE' })}
          >
            <option value="ADVANCE">{t('schedule.advance')}</option>
            <option value="MILESTONE">{t('schedule.milestone')}</option>
            <option value="DATE">{t('schedule.date')}</option>
          </Select>
          {row.billedOn === 'DATE' ? (
            <>
              <label htmlFor={`stage-${i}-dueDate`} className="sr-only">
                {t('schedule.dueDate')}
              </label>
              <DatePicker
                id={`stage-${i}-dueDate`}
                placeholder={t('schedule.dueDate')}
                value={row.dueDate}
                onChange={(value) => setStage(i, { dueDate: value })}
              />
            </>
          ) : null}
        </div>
      ),
    },
    {
      key: 'percentage',
      header: t('schedule.share'),
      required: true,
      width: '5.5rem',
      align: 'end',
      controlId: (i) => `stage-${i}-percentage`,
      cell: (row, i) => (
        <div className="relative">
          <Input
            id={`stage-${i}-percentage`}
            inputMode="decimal"
            value={row.percentage}
            aria-invalid={Boolean(attempted && stageErrors[i]?.percentage)}
            className="pe-8 text-end tabular-nums"
            onChange={(e) => setStage(i, { percentage: e.target.value })}
          />
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-caption text-muted-foreground">
            %
          </span>
        </div>
      ),
    },
    {
      key: 'amount',
      header: t('schedule.amount'),
      width: '7.5rem',
      align: 'end',
      cell: (row) => (
        <span className="block py-2 text-body-sm tabular-nums text-foreground">
          {money(installmentAmount(row.percentage, fields.contractValue || null))}
        </span>
      ),
    },
  ];

  return (
    <div>
      <FormActionBar
        back={
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link href={`/projects/${projectId}/commercial`}>
              <ArrowLeft size={15} aria-hidden="true" />
              {t('back')}
            </Link>
          </Button>
        }
        save={
          <Button type="button" onClick={submit} loading={record.isPending} loadingText={t('recording')}>
            {t('submit')}
          </Button>
        }
        discard={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/projects/${projectId}/commercial`}>{t('cancel')}</Link>
          </Button>
        }
        saveState={fields.signedDate || fields.contractValue || file ? 'dirty' : 'new'}
        saveStateLabels={{ new: t('state.new'), dirty: t('state.dirty'), clean: t('state.clean') }}
      />

      <div className="mb-5">
        <p className="text-micro font-semibold uppercase text-muted-foreground">{t('eyebrow')}</p>
        <h1 className="text-h1 font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {boqVersion ? t('subtitle', { version: boqVersion }) : t('subtitleNoBoq')}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <form
          noValidate
          className="min-w-0 space-y-8"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {attempted && (summaryErrors.length > 0 || planErrors.length > 0 || apiError) ? (
            <FormErrorSummary
              title={t('fixTitle')}
              errors={summaryErrors}
              formErrors={[...planErrors, ...(apiError ? [apiError] : [])]}
            />
          ) : null}

          <FormGroup title={t('sections.contract')}>
            <FormField htmlFor="record-client" label={t('labels.client')}>
              <Input id="record-client" value={clientName ?? '—'} readOnly aria-readonly="true" className="bg-surface-subtle" />
            </FormField>
            <FormField htmlFor="record-contractNumber" label={t('labels.contractNumber')} hint={t('referenceHint')}>
              <Input id="record-contractNumber" value={fields.contractNumber} maxLength={50} onChange={(e) => set('contractNumber', e.target.value)} />
            </FormField>
            <FormField htmlFor="record-signedDate" label={t('labels.signedDate')} required error={attempted ? fieldErrors.signedDate : undefined}>
              <DatePicker id="record-signedDate" value={fields.signedDate} onChange={(value) => set('signedDate', value)} />
            </FormField>
            <FormField htmlFor="record-contractValue" label={t('labels.contractValue')} hint={t('valueHint')} required error={attempted ? fieldErrors.contractValue : undefined}>
              <MoneyInput id="record-contractValue" value={fields.contractValue} onValueChange={(value) => set('contractValue', value)} placeholder="0.00" />
            </FormField>
            <FormField htmlFor="record-startDate" label={t('labels.startDate')}>
              <DatePicker id="record-startDate" value={fields.startDate} onChange={(value) => set('startDate', value)} />
            </FormField>
            <FormField htmlFor="record-expectedEndDate" label={t('labels.expectedEndDate')} error={attempted ? fieldErrors.expectedEndDate : undefined}>
              <DatePicker id="record-expectedEndDate" value={fields.expectedEndDate} onChange={(value) => set('expectedEndDate', value)} />
            </FormField>
            <FormField htmlFor="record-paymentTerms" label={t('labels.paymentTerms')}>
              <Select id="record-paymentTerms" searchable={false} value={fields.paymentTerms} onChange={(value) => set('paymentTerms', value as PaymentTermsKey)}>
                {PAYMENT_TERMS.map((key) => (
                  <option key={key} value={key}>
                    {t(`terms.${key}`)}
                  </option>
                ))}
              </Select>
            </FormField>
          </FormGroup>

          <section aria-labelledby="record-schedule-title" className="space-y-3">
            <div>
              <h2 id="record-schedule-title" className="text-h3 font-semibold text-foreground">
                {t('sections.schedule')}
              </h2>
              <p className="mt-1 text-body-sm text-muted-foreground">{t('schedule.hint')}</p>
            </div>
            <LineItemsEditor
              label={t('sections.schedule')}
              rows={stages}
              rowKey={(row) => String(row.key)}
              columns={columns}
              errors={(index) => (attempted ? inlineStageErrors(stageErrors[index]) : undefined)}
              cardTitle={(row, index) => `${index + 1}. ${row.name || t('schedule.untitled')}`}
              onAdd={() => setStages((current) => [...current, stageFromTemplate({ name: '', percentage: '', isAdvance: false, dueDate: '' })])}
              addLabel={t('schedule.add')}
              onRemove={(index) => setStages((current) => current.filter((_, i) => i !== index))}
              removeLabel={(index) => t('schedule.remove', { number: index + 1 })}
            />
            <p className="text-body-sm" role="status">
              <span className="text-muted-foreground">{t('schedule.allocated')}</span>{' '}
              <span className={Math.abs(allocated - 100) > 0.001 ? 'font-semibold text-danger' : 'font-semibold text-foreground'}>
                {round(allocated)}%
              </span>
            </p>
          </section>

          <section aria-labelledby="record-agreement-title" className="space-y-3">
            <h2 id="record-agreement-title" className="text-h3 font-semibold text-foreground">
              {t('sections.agreement')}
            </h2>
            <FileDrop
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              file={file}
              onFile={setFile}
              onRemove={() => setFile(null)}
              title={t('agreement.title')}
              hint={t('agreement.hint')}
              chooseLabel={t('agreement.choose')}
              removeLabel={t('agreement.remove')}
            />
          </section>
        </form>

        <SummaryRail
          className="self-start xl:sticky xl:top-32"
          title={t('rail.title')}
          rows={[
            { label: t('rail.contract'), value: t('rail.contractValue', { ref: fields.contractNumber.trim() || t('rail.auto') }) },
            { label: t('rail.scope'), value: boqVersion ? t('rail.boq', { version: boqVersion }) : '—' },
            { label: t('rail.value'), value: fields.contractValue ? money(fields.contractValue) : '—' },
            { label: t('rail.schedule'), value: t('rail.allocated', { percent: round(allocated) }) },
            { label: t('rail.billable'), value: advanceRow ? t('rail.advance') : t('rail.nothing') },
          ]}
        />
      </div>

      {confirming ? (
        <Dialog open onOpenChange={(open) => !open && !record.isPending && setConfirming(false)}>
          <DialogContent size="sm">
            <DialogTitle>{t('confirm.title')}</DialogTitle>
            <DialogDescription>
              {t('confirm.body', { value: money(fields.contractValue), version: boqVersion ?? '—' })}{' '}
              {advanceRow ? t('confirm.advance', { amount: money(advanceAmount) }) : t('confirm.noAdvance')}
            </DialogDescription>
            {apiError ? <Alert variant="error" messages={[apiError]} /> : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={record.isPending}>
                {t('confirm.cancel')}
              </Button>
              <Button onClick={confirm} loading={record.isPending} loadingText={t('recording')}>
                {t('confirm.submit')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/** The due date lives in the Billed on cell, so its message shows there too. */
function inlineStageErrors(errors: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!errors?.dueDate) return errors;
  const { dueDate, ...rest } = errors;
  return { ...rest, billedOn: dueDate };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
