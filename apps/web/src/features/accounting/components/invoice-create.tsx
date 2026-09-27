'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Combobox,
  DatePicker,
  EmptyState,
  FormActionBar,
  FormField,
  FormGroup,
  Input,
  LifecycleStepper,
  LineItemsEditor,
  RadioGroup,
  TotalsBlock,
  type LineColumn,
} from '@erp/ui';
import { ArrowLeft, FileBadge, Flag, ListPlus, Receipt } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { FormErrorSummary, type FormFieldError } from '@/components/form-error-summary';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useCreateSeparateChargeInvoice } from '@/features/commercial/hooks/use-commercial';
import { toMilestoneJourneyViewModel } from '@/features/commercial/milestone-journey.adapter';
import type { InvoiceJourneyPhase } from '@/features/commercial/milestone-journey.adapter';
import { PrepareInvoiceDialog } from '@/features/commercial/components/prepare-invoice-dialog';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { formatMoney } from '@/lib/format';

import { defaultDueDate } from '../invoice-actions';
import { invoiceKeys, useGenerateInvoice } from '../hooks/use-invoices';
import {
  INVOICE_SOURCE_KINDS,
  useInvoiceSources,
  useProjectCommercialSummary,
  type InvoiceSourceKind,
  type InvoiceSourceOption,
} from '../hooks/use-invoice-sources';

/**
 * ─── New client invoice: a source picker, not a blank form (ADR-037) ─────────────
 *
 * A client invoice is source-bound. Its amount, client, contract and currency come from a
 * certified IPC, a billing milestone or a SEPARATE_CHARGE BOQ leaf and are immutable afterwards
 * (ADR-029 CONST-BOQ-030/033). So this page asks *what* is being invoiced, lists what is billable
 * of that kind on the chosen project, and shows the source's line read-only. There are no
 * editable lines, no discount and no client reference, because the model has none.
 *
 * Each source goes through the same guarded command the product already uses for it:
 *
 *   - IPC             → `POST /invoices/from-ipc` (`useGenerateInvoice`, as the IPC billing card).
 *                       Creates a DRAFT; approve and post follow on the invoice page.
 *   - SEPARATE_CHARGE → `POST /invoices/from-separate-charge` (`useCreateSeparateChargeInvoice`).
 *                       Creates a DRAFT, the same lifecycle stage as the IPC path.
 *   - INSTALLMENT     → the commercial billing-package flow, via the same `PrepareInvoiceDialog`
 *                       the Contract & Milestones tab opens. `issue-package` enforces the Slice 3B
 *                       ready-to-bill gate and nets/bills the stage's variations; the bare
 *                       `POST /invoices/from-installment` does neither, so calling it from here
 *                       would bypass the gate and could orphan a variation's billing. Issuing
 *                       approves AND posts in one step — so for a milestone the primary action is
 *                       "Prepare invoice", not "Save draft", and the page says so.
 */

const LIFECYCLE_KEYS = ['DRAFT', 'APPROVED', 'POSTED'] as const;
const PAYMENT_TERMS_MAX = 100;
const LIST_HREF = '/finance/accounting/invoices';

const KIND_ICONS: Record<InvoiceSourceKind, React.ReactNode> = {
  IPC: <FileBadge size={16} />,
  INSTALLMENT: <Flag size={16} />,
  SEPARATE_CHARGE: <ListPlus size={16} />,
};

const FIELD_IDS = {
  kind: 'invoice-kind-IPC',
  project: 'invoice-project',
  source: 'invoice-source',
  invoiceDate: 'invoice-date',
  dueDate: 'invoice-due-date',
  terms: 'invoice-terms',
} as const;

type FieldKey = keyof typeof FIELD_IDS;

interface SourceLine {
  description: string;
  amount: string | null;
  currency: string | null;
}

export function InvoiceCreate() {
  const t = useTranslations('accounting.invoices.create');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  useModuleTrail(t('title'));

  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState<InvoiceSourceKind | ''>('');
  const [projectId, setProjectId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(() => defaultDueDate(today));
  const [dueTouched, setDueTouched] = useState(false);
  const [paymentTerms, setPaymentTerms] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [preparing, setPreparing] = useState(false);

  const projects = useProjects();
  const summary = useProjectCommercialSummary(projectId);
  const currency = summary.data?.currency ?? null;
  const sources = useInvoiceSources(kind, projectId, currency, (row) =>
    row.applicationRef ?? t('applicationNumber', { number: row.applicationNumber ?? '—' }),
  );

  const generateFromIpc = useGenerateInvoice();
  const createSeparateCharge = useCreateSeparateChargeInvoice(projectId);
  const isSaving = generateFromIpc.isPending || createSeparateCharge.isPending;

  const mayCreate = can(ACCOUNTING_PERMISSIONS.manageReceivables);
  const isMilestone = kind === 'INSTALLMENT';
  const financialsVisible = summary.data?.financialsVisible ?? true;

  const selected: InvoiceSourceOption | null =
    sources.options.find((option) => option.id === sourceId) ?? null;

  const line: SourceLine | null =
    kind && selected
      ? {
          description: `${t(`kind.${kind}.label`)} — ${selected.reference}${selected.hint && kind === 'INSTALLMENT' ? ` · ${selected.hint}` : ''}`,
          amount: selected.amount,
          currency: selected.currency ?? currency,
        }
      : null;

  const projectOptions = useMemo(
    () =>
      (projects.data ?? [])
        // An internal-capital project has no client to invoice.
        .filter((project) => project.commercialModel !== 'INTERNAL_CAPITAL')
        .map((project) => ({ value: project.id, label: project.name, hint: project.code })),
    [projects.data],
  );

  const sourceOptions = sources.options.map((option) => ({
    value: option.id,
    label: kind === 'IPC' ? t('ipcOption', { application: option.reference }) : option.reference,
    hint: option.hint,
    meta:
      financialsVisible && option.amount
        ? (formatMoney(option.amount, option.currency ?? currency, 'en') ?? undefined)
        : undefined,
  }));

  // ── Validation ─────────────────────────────────────────────────────────────
  const errors: Partial<Record<FieldKey, string>> = {};
  if (!kind) errors.kind = t('errors.kindRequired');
  if (!projectId) errors.project = t('errors.projectRequired');
  if (!sourceId) errors.source = t('errors.sourceRequired');
  if (!isMilestone) {
    if (!invoiceDate) errors.invoiceDate = t('errors.invoiceDateRequired');
    if (!dueDate) errors.dueDate = t('errors.dueDateRequired');
    if (paymentTerms.trim().length > PAYMENT_TERMS_MAX) errors.terms = t('errors.termsTooLong');
  }
  const shown = attempted ? errors : {};

  const fieldLabels: Record<FieldKey, string> = {
    kind: t('kindLabel'),
    project: t('project'),
    source: kind ? t(`source.${kind}.label`) : t('kindLabel'),
    invoiceDate: t('invoiceDate'),
    dueDate: t('dueDate'),
    terms: t('terms'),
  };
  const summaryErrors: FormFieldError[] = (Object.keys(shown) as FieldKey[]).map((key) => ({
    label: fieldLabels[key],
    fieldId: FIELD_IDS[key],
    message: shown[key] as string,
  }));

  const isDirty = kind !== '' || projectId !== '' || paymentTerms !== '';

  // ── Commands ───────────────────────────────────────────────────────────────
  const openInvoice = (id: string) => router.push(`${LIST_HREF}/${id}`);

  async function handleSave() {
    setAttempted(true);
    setSaveError(null);
    if (Object.keys(errors).length > 0 || !kind) return;

    if (kind === 'INSTALLMENT') {
      setPreparing(true);
      return;
    }

    const common = {
      invoiceDate,
      dueDate,
      paymentTerms: paymentTerms.trim() || undefined,
    };
    try {
      const created =
        kind === 'IPC'
          ? await generateFromIpc.mutateAsync({ ipcId: sourceId, ...common })
          : await createSeparateCharge.mutateAsync({ boqNodeId: sourceId, ...common });
      if (kind === 'SEPARATE_CHARGE') {
        // The separate-charge hook refreshes the commercial views only; the AR list moved too.
        void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      }
      openInvoice(created.id);
    } catch (error) {
      setSaveError(error instanceof Error && error.message ? error.message : t('saveFailed'));
    }
  }

  function handleMilestoneIssued(_installmentId: string, journey: InvoiceJourneyPhase) {
    void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
    setPreparing(false);
    openInvoice(journey.invoiceId);
  }

  const leave = () => router.push(LIST_HREF);

  // ── Restricted ─────────────────────────────────────────────────────────────
  if (!mayCreate) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="gap-1.5 px-2" asChild>
          <Link href={LIST_HREF}>
            <ArrowLeft size={16} aria-hidden="true" />
            {t('back')}
          </Link>
        </Button>
        <Alert variant="warning" title={t('noPermissionTitle')} messages={[t('noPermissionBody')]} />
      </div>
    );
  }

  const milestoneVm =
    isMilestone && summary.data && sources.currentCycle?.paymentSchedule
      ? (toMilestoneJourneyViewModel(
          sources.currentCycle.paymentSchedule,
          summary.data.financialsVisible,
        ).milestones.find((m) => m.id === sourceId) ?? null)
      : null;

  const lineColumns: LineColumn<SourceLine>[] = [
    {
      key: 'description',
      header: t('colDescription'),
      width: 'minmax(0,1fr)',
      cell: (row) => <span className="text-foreground">{row.description}</span>,
    },
    {
      key: 'amount',
      header: t('colAmount'),
      width: '10rem',
      align: 'end',
      cell: (row) => (
        <bdi className="tabular-nums text-foreground">
          {financialsVisible && row.amount ? (formatMoney(row.amount, row.currency, 'en') ?? row.amount) : '—'}
        </bdi>
      ),
    },
  ];

  const sourceHint = (() => {
    if (!projectId) return t('chooseProjectFirst');
    if (kind && !sources.isLoading && !sources.isError && sources.options.length === 0) {
      return t(`source.${kind}.empty`);
    }
    return t('sourceHint');
  })();

  const clientName = projectId ? (summary.data?.mainContract?.clientName ?? '') : '';

  return (
    <div className="space-y-6">
      <FormActionBar
        back={
          <Button variant="ghost" className="gap-1.5 px-2" asChild>
            <Link href={LIST_HREF}>
              <ArrowLeft size={16} aria-hidden="true" />
              {t('back')}
            </Link>
          </Button>
        }
        save={
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? t('saving') : isMilestone ? t('prepareMilestone') : t('saveDraft')}
          </Button>
        }
        discard={
          <Button
            variant="ghost"
            onClick={() => (isDirty ? setConfirmDiscard(true) : leave())}
            disabled={isSaving}
          >
            {t('discard')}
          </Button>
        }
        saveState={isDirty ? 'dirty' : 'new'}
        saveStateLabels={{
          new: tCommon('formState.new'),
          dirty: tCommon('formState.dirty'),
          clean: tCommon('formState.clean'),
        }}
        lifecycle={
          <LifecycleStepper
            steps={LIFECYCLE_KEYS.map((key) => ({ key, label: t(`lifecycle.${key}`) }))}
            current="DRAFT"
            stepOfLabel={(n, total) => t('stepOf', { n, total })}
          />
        }
      />

      <header className="space-y-1">
        <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          {t('eyebrow')}
        </p>
        <h2 className="text-h2 font-semibold text-foreground">{t('title')}</h2>
        <p className="max-w-prose text-body-sm text-muted-foreground">{t('intro')}</p>
      </header>

      <FormErrorSummary errors={summaryErrors} formErrors={saveError ? [saveError] : []} />

      <RadioGroup<InvoiceSourceKind>
        label={t('kindLabel')}
        name="invoice-kind"
        required
        variant="card"
        value={kind}
        onChange={(next) => {
          setKind(next);
          setSourceId('');
          setSaveError(null);
        }}
        options={INVOICE_SOURCE_KINDS.map((value) => ({
          value,
          label: t(`kind.${value}.label`),
          description: t(`kind.${value}.description`),
          icon: KIND_ICONS[value],
        }))}
      />
      {shown.kind ? (
        <p className="-mt-4 text-caption font-medium text-danger" role="alert">
          {shown.kind}
        </p>
      ) : null}

      <FormGroup title={t('detailsTitle')} description={t('detailsDescription')}>
        <FormField htmlFor={FIELD_IDS.project} label={t('project')} required error={shown.project}>
          <Combobox
            id={FIELD_IDS.project}
            value={projectId}
            onChange={(next) => {
              setProjectId(next);
              setSourceId('');
              setSaveError(null);
            }}
            options={projectOptions}
            placeholder={t('projectPlaceholder')}
            searchPlaceholder={t('projectSearch')}
            emptyLabel={t('projectEmpty')}
            loading={projects.isPending}
            loadingLabel={t('loading')}
            invalid={Boolean(shown.project)}
            aria-required
          />
        </FormField>

        <FormField
          htmlFor={FIELD_IDS.source}
          label={kind ? t(`source.${kind}.label`) : t('source.IPC.label')}
          required
          hint={sourceHint}
          error={shown.source}
        >
          <Combobox
            id={FIELD_IDS.source}
            value={sourceId}
            onChange={(next) => {
              setSourceId(next);
              setSaveError(null);
            }}
            options={sourceOptions}
            placeholder={kind ? t(`source.${kind}.placeholder`) : t('source.IPC.placeholder')}
            searchPlaceholder={t('sourceSearch')}
            emptyLabel={t('sourceNoMatch')}
            loading={sources.isLoading}
            loadingLabel={t('loading')}
            disabled={!kind || !projectId}
            invalid={Boolean(shown.source)}
            aria-describedby={`${FIELD_IDS.source}-hint`}
            aria-required
          />
        </FormField>

        {sources.isError ? (
          <Alert
            className="sm:col-span-2"
            variant="error"
            title={t('sourceLoadFailed')}
            action={
              <Button variant="outline" size="sm" onClick={sources.refetch}>
                {t('retry')}
              </Button>
            }
          />
        ) : null}

        <FormField htmlFor="invoice-client" label={t('client')} hint={t('clientHint')}>
          <Input id="invoice-client" readOnly value={clientName} placeholder={t('clientPending')} />
        </FormField>

        {isMilestone ? (
          <p className="text-body-sm text-muted-foreground sm:col-span-2">{t('milestoneIssueNote')}</p>
        ) : (
          <>
            <FormField
              htmlFor={FIELD_IDS.invoiceDate}
              label={t('invoiceDate')}
              required
              error={shown.invoiceDate}
            >
              <DatePicker
                id={FIELD_IDS.invoiceDate}
                value={invoiceDate}
                onChange={(next) => {
                  setInvoiceDate(next);
                  if (!dueTouched && next) setDueDate(defaultDueDate(next));
                }}
              />
            </FormField>
            <FormField
              htmlFor={FIELD_IDS.dueDate}
              label={t('dueDate')}
              required
              hint={t('dueDateHint')}
              error={shown.dueDate}
            >
              <DatePicker
                id={FIELD_IDS.dueDate}
                value={dueDate}
                min={invoiceDate || undefined}
                onChange={(next) => {
                  setDueDate(next);
                  setDueTouched(true);
                }}
              />
            </FormField>
            <FormField htmlFor={FIELD_IDS.terms} label={t('terms')} error={shown.terms}>
              <Input
                id={FIELD_IDS.terms}
                value={paymentTerms}
                onChange={(event) => setPaymentTerms(event.target.value)}
                placeholder={t('termsPlaceholder')}
                maxLength={PAYMENT_TERMS_MAX}
              />
            </FormField>
          </>
        )}
      </FormGroup>

      <section className="space-y-3" aria-labelledby="invoice-lines-heading">
        <div className="border-b border-border pb-2">
          <h2 id="invoice-lines-heading" className="text-body font-semibold text-foreground">
            {t('linesTitle')}
          </h2>
          <p className="text-caption text-muted-foreground">{t('linesNote')}</p>
        </div>

        {line ? (
          <LineItemsEditor<SourceLine>
            label={t('linesLabel')}
            rows={[line]}
            rowKey={() => sourceId}
            columns={lineColumns}
            cardTitle={(_row, index) => t('lineCard', { n: index + 1 })}
            readOnly
          />
        ) : (
          <EmptyState
            variant="inline"
            icon={<Receipt size={20} aria-hidden="true" />}
            title={t('emptyLinesTitle')}
            description={t('emptyLinesHint')}
          />
        )}

        {line ? (
          <div className="flex flex-col items-end gap-1">
            <TotalsBlock
              className="sm:max-w-sm"
              hidden={!financialsVisible}
              hiddenLabel={t('amountsHidden')}
              rows={[]}
              total={{
                label: t('totalBeforeVat'),
                value: (
                  <bdi>{line.amount ? (formatMoney(line.amount, line.currency, 'en') ?? line.amount) : '—'}</bdi>
                ),
              }}
            />
            {financialsVisible ? (
              <p className="text-caption text-muted-foreground">{t('vatNote')}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      {confirmDiscard ? (
        <ConfirmActionDialog
          title={tCommon('unsavedChanges.title')}
          description={tCommon('unsavedChanges.body')}
          confirmLabel={tCommon('unsavedChanges.leave')}
          isPending={false}
          onConfirm={leave}
          onDismiss={() => setConfirmDiscard(false)}
        />
      ) : null}

      {isMilestone && summary.data ? (
        <PrepareInvoiceDialog
          key={preparing ? sourceId : 'closed'}
          open={preparing && milestoneVm !== null}
          milestone={milestoneVm}
          summary={summary.data}
          onInvoiceIssued={handleMilestoneIssued}
          onClose={() => setPreparing(false)}
        />
      ) : null}
    </div>
  );
}
