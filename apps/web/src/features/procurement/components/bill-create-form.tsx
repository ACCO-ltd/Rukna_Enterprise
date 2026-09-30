'use client';

/**
 * New supplier bill — one create page for both kinds of bill (ADR-037).
 *
 * It replaces two forms (a non-PO bill and a PO bill) that were separate routes in all but
 * name. The kind is now the first question on the page, a card choice, because it decides
 * everything below it:
 *
 *  - **Against a purchase order** — the supplier narrows the PO list; choosing a PO resolves
 *    its ACTIVE revision and posted receipts ("System finds"), and seeds one read-only-item line
 *    per PO line with Ordered and Received beside what is being billed. A line billing more
 *    than was received carries a warning note: the three-way match on submit will likely raise
 *    an exception. Cost coding is inherited from the PO line (D7), shown as a chip, never keyed.
 *  - **Direct expense** — no PO, so matching does not apply. The bill names its project (or says
 *    it belongs to none — overhead), and for a project each line names the BOQ item or project
 *    cost category it is for: the attribution `validateCostTarget` requires on the server.
 *
 * Saving creates a DRAFT and nothing more. The stepper in the action bar says so, and the
 * intro line says it in words: submit, approve and post are separate commands on the bill.
 *
 * **Edit mode** (ADR-037 amendment) is the same form, not a fork: `initialBill` prefills every
 * field and line through `billToFormValues`, a PO bill's billed figures are laid over the PO's
 * lines once they load (`applyBilledFigures`), and Save PATCHes the draft. Only a DRAFT bill —
 * new, or returned for correction — reaches it; `SupplierBillEditPage` refuses anything else.
 *
 * Line rules, previews and payloads live in `../bill-create.ts`, pure and unit-tested.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DatePicker,
  Notice,
  FormActionBar,
  FormField,
  FormGroup,
  Input,
  LifecycleStepper,
  LineItemsEditor,
  MoneyInput,
  QuantityInput,
  formatThousands,
  SkeletonRecord,
  RadioGroup,
  Select,
  TotalsBlock,
  type LineColumn,
} from '@erp/ui';
import { ArrowLeft, ClipboardCheck, Receipt } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { FormErrorSummary, type FormFieldError } from '@/components/form-error-summary';
import { ModuleTrail, useModuleTrail } from '@/components/layout/module-chrome';
import { accountName } from '@/features/accounting/account-display';
import { useAccounts, usePostingProfiles } from '@/features/accounting/hooks/use-accounting';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { ApiError } from '@/lib/api-client';
import { formatMoney, formatNumber } from '@/lib/format';
import { MONEY_SCALE, QUANTITY_SCALE, fromMinorUnits } from '@/lib/money';

import { BILL_STAGES, canEditBill, expenseProfiles, type ExpenseProfile } from '../bill-actions';
import {
  NO_PROJECT,
  applyBilledFigures,
  billToFormValues,
  billTotalsMinor,
  buildDirectBillPayload,
  buildPoBillPayload,
  dueDateFromTerms,
  directLineErrors,
  emptyDirectLine,
  findDuplicateBill,
  lineAmountMinor,
  netVariance,
  overBilling,
  poLineErrors,
  receivedByPoLine,
  seedPoLine,
  type BilledFigures,
  type BillKind,
  type DirectLineDraft,
  type LineErrors,
  type NetFigures,
  type PoLineDraft,
} from '../bill-create';
import { systemFinds } from '../bill-po-match';
import {
  useCreateSupplierBill,
  useGoodsReceipts,
  usePurchaseOrder,
  useSpendCategories,
  useSupplierBill,
  useSupplierBills,
  useSuppliers,
  useUpdateSupplierBill,
} from '../hooks/use-procurement';
import type { SupplierBill } from '../types';
import { ClassificationChips } from './classification-chips';
import { useProjectCostNodes } from './po-cost-target-picker';
import { PurchaseOrderPicker } from './purchase-order-picker';
import { SupplierPicker } from './supplier-picker';

const BILLS_HREF = '/finance/accounting/bills';

const IDS = {
  supplier: 'bill-supplier',
  invoiceNumber: 'bill-invoice-number',
  purchaseOrder: 'bill-purchase-order',
  project: 'bill-project',
  billDate: 'bill-date',
  dueDate: 'bill-due-date',
} as const;

const lineId = (index: number, column: string) => `bill-line-${index}-${column}`;

type HeaderField = keyof typeof IDS;

/** One option of a direct line's Cost line select. */
interface CostLineOption {
  value: string;
  label: string;
}

interface CostLineOptions {
  nodes: CostLineOption[];
  categories: CostLineOption[];
  loading: boolean;
}

/**
 * What the form compares to decide whether an edit has changed anything. Line keys are left out:
 * they are React's, not the bill's.
 */
function formSignature(values: {
  kind: BillKind;
  supplierId: string;
  invoiceNumber: string;
  purchaseOrderId: string;
  projectChoice: string;
  billDate: string;
  dueDate: string;
  directLines: readonly DirectLineDraft[];
  poLines: readonly PoLineDraft[];
}): string {
  return JSON.stringify([
    values.kind,
    values.supplierId,
    values.invoiceNumber,
    values.purchaseOrderId,
    values.projectChoice,
    values.billDate,
    values.dueDate,
    values.kind === 'direct'
      ? values.directLines.map((l) => [
          l.description,
          l.expenseProfileCode,
          l.quantity,
          l.unitPrice,
          l.vatAmount,
          l.costLine,
        ])
      : null,
    values.kind === 'po'
      ? values.poLines.map((l) => [l.poLineId, l.quantity, l.unitPrice, l.vatAmount, l.expenseProfileCode])
      : null,
  ]);
}

// ─── Edit page ────────────────────────────────────────────────────────────────

/**
 * `/finance/accounting/bills/:id/edit` — loads the bill and renders the form in edit mode, or
 * says why it cannot: only a DRAFT bill (new, or returned for correction) can be edited.
 */
export function SupplierBillEditPage({ id }: { id: string }) {
  const t = useTranslations('procurement.bills.create');
  const tc = useTranslations('procurement.common');
  const tStatus = useTranslations('procurement.status');
  const query = useSupplierBill(id);
  const billHref = `${BILLS_HREF}/${id}`;

  if (query.isPending) {
    return (
      <>
        <ModuleTrail label={t('editTitle')} />
        <SkeletonRecord label={tc('loading')} />
      </>
    );
  }

  if (query.isError || !query.data) {
    return (
      <>
        <ModuleTrail label={t('editTitle')} />
        <Alert variant="error" messages={[tc('loadFailed')]} />
      </>
    );
  }

  const bill = query.data;
  if (!canEditBill(bill)) {
    return (
      <>
        <ModuleTrail label={bill.billNumber ?? tStatus(bill.documentStatus)} />
        <Notice
          tone="attention"
          title={t('notDraft')}
          action={
            <Button asChild variant="outline">
              <Link href={billHref}>{t('backToBill')}</Link>
            </Button>
          }
        />
      </>
    );
  }

  // Keyed by the bill, so a different bill starts from its own values rather than the last one's.
  return <SupplierBillCreateForm key={bill.id} initialKind="direct" initialBill={bill} />;
}

// ─── The form ─────────────────────────────────────────────────────────────────

export function SupplierBillCreateForm({
  initialKind,
  initialBill,
}: {
  initialKind: BillKind;
  /** Edit mode: the DRAFT bill being corrected. Its values replace `initialKind` and the blanks. */
  initialBill?: SupplierBill;
}) {
  const t = useTranslations('procurement.bills.create');
  const tBills = useTranslations('procurement.bills');
  const tLine = useTranslations('procurement.bills.lineError');
  const tPo = useTranslations('procurement.bills.po');
  const tStatus = useTranslations('procurement.status');
  const tPosting = useTranslations('procurement.postingStatus');
  const tForm = useTranslations('common.formState');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en';
  const router = useRouter();

  // Read once: the form owns its values from here on.
  const [initial] = useState(() => (initialBill ? billToFormValues(initialBill) : null));
  const editing = initialBill !== undefined;
  const billHref = initialBill ? `${BILLS_HREF}/${initialBill.id}` : BILLS_HREF;
  const title = !initialBill
    ? t('title')
    : initialBill.billNumber
      ? t('editTitleNumbered', { number: initialBill.billNumber })
      : t('editTitle');

  useModuleTrail(initialBill ? (initialBill.billNumber ?? t('editTitle')) : t('title'));

  const [kind, setKind] = useState<BillKind>(initial?.kind ?? initialKind);
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(initial?.invoiceNumber ?? '');
  const [purchaseOrderId, setPurchaseOrderId] = useState(initial?.purchaseOrderId ?? '');
  const [projectChoice, setProjectChoice] = useState(initial?.projectChoice ?? '');
  const [billDate, setBillDate] = useState(initial?.billDate ?? '');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  // The payment-terms days the due date was derived from, or null once it has been typed. An
  // edited bill's due date is the one it was saved with — treated as typed, never re-derived.
  const [dueDateTerms, setDueDateTerms] = useState<number | null>(null);
  const [directLines, setDirectLines] = useState<DirectLineDraft[]>(() =>
    initial?.directLines.length ? initial.directLines : [emptyDirectLine()],
  );
  const [poLines, setPoLines] = useState<PoLineDraft[]>([]);
  // Edit mode, PO bill: the saved figures, waiting for the PO's lines to load. Applied once.
  const [pendingFigures, setPendingFigures] = useState<BilledFigures[] | null>(
    initial?.kind === 'po' ? initial.poFigures : null,
  );
  // Edit mode: the values as saved, to tell a changed form from an untouched one. A PO bill's
  // baseline is taken when its figures are applied, since its lines only exist from then.
  const [baseline, setBaseline] = useState<string | null>(() =>
    initial?.kind === 'direct' ? formSignature({ ...initial, poLines: [] }) : null,
  );
  const [submitted, setSubmitted] = useState(false);
  // Bumped on every refused save, so the summary is brought into view each time.
  const [refusals, setRefusals] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const create = useCreateSupplierBill();
  const update = useUpdateSupplierBill();
  // The one mutation this page runs — create a draft, or save changes to one.
  const save = editing ? update : create;
  const suppliers = useSuppliers();
  const accounts = useAccounts();
  const profiles = usePostingProfiles();
  const supplierBills = useSupplierBills({ supplierId }, { enabled: Boolean(supplierId) });

  const options = useMemo(
    () => expenseProfiles(profiles.data ?? [], accounts.data ?? []),
    [profiles.data, accounts.data],
  );
  // Every line names a profile. With none resolvable the only required select would be empty
  // and every save would 400 — so say what is wrong and withhold Save instead.
  const noProfiles = !profiles.isPending && !accounts.isPending && options.length === 0;

  const supplier = suppliers.data?.find((s) => s.id === supplierId) ?? null;

  // ─── Purchase order: "System finds" and the seeded lines ──────────────────────
  const po = usePurchaseOrder(purchaseOrderId);
  const receipts = useGoodsReceipts(purchaseOrderId ? { purchaseOrderId } : undefined);
  const finds = useMemo(
    () => (purchaseOrderId ? systemFinds(po.data, receipts.data) : null),
    [purchaseOrderId, po.data, receipts.data],
  );
  const received = useMemo(() => receivedByPoLine(receipts.data), [receipts.data]);
  const poResolving = Boolean(purchaseOrderId) && (po.isPending || receipts.isPending);
  const poNotBillable = Boolean(purchaseOrderId) && !poResolving && !finds;

  // Seed one line per PO line when a PO resolves, and reseed when a different one does. A
  // setState during render guarded by a stored signature — React's "reset state when a prop
  // changes" — so edits to the lines of the SAME order are kept.
  const poSignature = finds ? `${finds.poNumber}:${finds.poLines.map((l) => l.id).join(',')}` : '';
  const [seededSignature, setSeededSignature] = useState('');
  if (poSignature !== seededSignature) {
    setSeededSignature(poSignature);
    let seeded = finds ? finds.poLines.map((l) => seedPoLine(l, received, !finds.noReceipts)) : [];
    // Edit mode: the first time the bill's own PO resolves, its lines carry what was billed.
    if (finds && pendingFigures && initial && purchaseOrderId === initial.purchaseOrderId) {
      seeded = applyBilledFigures(seeded, pendingFigures);
      setPendingFigures(null);
      setBaseline(formSignature({ ...initial, poLines: seeded }));
    }
    setPoLines(seeded);
  }
  // What was received is read live, so a receipt posted while the form is open shows up.
  const poRows = useMemo(
    () =>
      poLines.map((line) => ({
        ...line,
        received: finds && !finds.noReceipts
          ? (received.get(line.poLineId) ?? { acceptedMinor: 0, grnNumbers: [] })
          : null,
      })),
    [poLines, finds, received],
  );

  // ─── Derived: duplicates, totals, dirty ──────────────────────────────────────
  // The bill being edited never duplicates itself.
  const duplicate = findDuplicateBill(supplierBills.data ?? [], supplierId, invoiceNumber, initialBill?.id);
  const totals = billTotalsMinor(kind === 'po' ? poRows : directLines);
  const dirty = editing
    ? baseline !== null &&
      formSignature({
        kind,
        supplierId,
        invoiceNumber,
        purchaseOrderId,
        projectChoice,
        billDate,
        dueDate,
        directLines,
        poLines,
      }) !== baseline
    : Boolean(supplierId || invoiceNumber || purchaseOrderId || projectChoice || billDate || dueDate) ||
      directLines.some(
        (l) => l.description || l.unitPrice || l.vatAmount || l.expenseProfileCode || l.costLine || l.quantity !== '1',
      );

  useEffect(() => {
    if (refusals > 0) summaryRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [refusals]);

  useEffect(() => {
    if (!dirty || save.isSuccess) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, save.isSuccess]);

  // ─── Errors ───────────────────────────────────────────────────────────────────
  const serverConflict =
    save.error instanceof ApiError && save.error.status === 409 ? save.error.message : null;

  const headerErrors: Partial<Record<HeaderField, string>> = {};
  if (!supplierId) headerErrors.supplier = t('errors.supplier');
  if (!invoiceNumber.trim()) headerErrors.invoiceNumber = t('errors.invoiceNumber');
  if (kind === 'po' && !purchaseOrderId) headerErrors.purchaseOrder = t('errors.purchaseOrder');
  if (kind === 'po' && poNotBillable) headerErrors.purchaseOrder = tPo('poNotBillable');
  if (kind === 'direct' && !projectChoice) headerErrors.project = t('errors.project');
  if (!billDate) headerErrors.billDate = t('errors.billDate');
  if (!dueDate) headerErrors.dueDate = t('errors.dueDate');

  const lineErrors: LineErrors[] =
    kind === 'po' ? poRows.map(poLineErrors) : directLines.map((l) => directLineErrors(l, projectChoice));
  const lineCount = kind === 'po' ? poRows.length : directLines.length;
  const noLinesError = kind === 'direct' && lineCount === 0;

  const hasBlockingError =
    Object.keys(headerErrors).length > 0 ||
    lineErrors.some((e) => Object.keys(e).length > 0) ||
    noLinesError ||
    (kind === 'po' && (poResolving || !finds));

  const shownHeader = (field: HeaderField): string | undefined =>
    field === 'invoiceNumber' && serverConflict
      ? serverConflict
      : submitted
        ? headerErrors[field]
        : undefined;

  const lineErrorText = (key: string | undefined) =>
    key === undefined ? undefined : key === 'costLine' ? t('errors.costLine') : tLine(key);

  const cellErrors = (index: number): Partial<Record<string, string>> | undefined => {
    if (!submitted) return undefined;
    const errors = lineErrors[index] ?? {};
    return Object.fromEntries(
      Object.entries(errors).map(([column, key]) => [column, lineErrorText(key)]),
    );
  };

  const headerLabels: Record<HeaderField, string> = {
    supplier: t('supplier'),
    invoiceNumber: t('invoiceNumber'),
    purchaseOrder: t('purchaseOrder'),
    project: t('project'),
    billDate: t('billDate'),
    dueDate: t('dueDate'),
  };
  const columnLabels: Record<string, string> = {
    description: t('col.description'),
    profile: t('col.expenseProfile'),
    quantity: kind === 'po' ? t('col.billedQty') : t('col.qty'),
    unitPrice: t('col.unitPrice'),
    vat: t('col.vat'),
    amount: t('col.amount'),
    costLine: t('col.costLine'),
  };

  const summaryErrors: FormFieldError[] = [];
  (Object.keys(IDS) as HeaderField[]).forEach((field) => {
    const message = shownHeader(field);
    if (message) summaryErrors.push({ label: headerLabels[field], fieldId: IDS[field], message });
  });
  if (submitted) {
    lineErrors.forEach((errors, index) => {
      for (const [column, key] of Object.entries(errors)) {
        summaryErrors.push({
          label: t('errorLine', { n: index + 1, field: columnLabels[column] ?? column }),
          fieldId: lineId(index, column),
          message: lineErrorText(key) ?? '',
        });
      }
    });
  }
  const formErrors: string[] = [];
  if (submitted && noLinesError) formErrors.push(t('errors.noLines'));
  if (save.error && !serverConflict) {
    formErrors.push(save.error instanceof ApiError ? save.error.message : t('failed'));
  }
  const showSummary = summaryErrors.length > 0 || formErrors.length > 0;

  // ─── Handlers ─────────────────────────────────────────────────────────────────

  /**
   * Due date follows the supplier's terms while the user has not typed one: set from
   * `billDate + paymentTermsDays`, re-derived when either changes, and cleared if the new
   * supplier has no terms (a date derived from another supplier's terms would be wrong).
   */
  function deriveDueDate(nextSupplierId: string, nextBillDate: string) {
    if (dueDate && dueDateTerms === null) return; // typed by hand — never overwrite it
    const terms = suppliers.data?.find((s) => s.id === nextSupplierId)?.paymentTermsDays ?? null;
    const next = dueDateFromTerms(nextBillDate, terms);
    if (next) {
      setDueDate(next);
      setDueDateTerms(terms);
    } else if (dueDateTerms !== null) {
      setDueDate('');
      setDueDateTerms(null);
    }
  }

  function handleSupplierChange(next: string) {
    setSupplierId(next);
    // A PO belongs to one supplier; a stale selection would resolve a mismatched order.
    setPurchaseOrderId('');
    deriveDueDate(next, billDate);
    if (save.error) save.reset();
  }

  function handleBillDateChange(next: string) {
    setBillDate(next);
    deriveDueDate(supplierId, next);
  }

  function updateDirect(index: number, patch: Partial<DirectLineDraft>) {
    setDirectLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function updatePo(index: number, patch: Partial<PoLineDraft>) {
    setPoLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addDirectLine(focus: boolean) {
    const index = directLines.length;
    setDirectLines((prev) => [...prev, emptyDirectLine()]);
    if (focus) {
      window.setTimeout(() => document.getElementById(lineId(index, 'description'))?.focus(), 0);
    }
  }

  function handleProjectChange(next: string) {
    setProjectChoice(next);
    // A cost line belongs to one project's BOQ; one chosen under another project is meaningless.
    setDirectLines((prev) => prev.map((line) => ({ ...line, costLine: '' })));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (save.isPending) return;
    if (hasBlockingError) {
      setRefusals((n) => n + 1);
      return;
    }

    const header = { supplierId, invoiceNumber, billDate, dueDate };
    const payload =
      kind === 'po'
        ? buildPoBillPayload(header, purchaseOrderId, poRows)
        : buildDirectBillPayload(header, projectChoice, directLines);

    const onSuccess = (bill: SupplierBill) => router.push(`${BILLS_HREF}/${bill.id}`);
    if (initialBill) update.mutate({ id: initialBill.id, payload }, { onSuccess });
    else create.mutate(payload, { onSuccess });
  }

  // Discarding an edit goes back to the bill; discarding a new bill goes back to the list.
  const leave = () => router.push(billHref);

  // ─── Render ───────────────────────────────────────────────────────────────────

  const money = (minor: number) => formatMoney(fromMinorUnits(minor, MONEY_SCALE), 'USD', locale) ?? '';

  const dueDateHint =
    dueDateTerms !== null
      ? t('dueDateFromTerms', { days: dueDateTerms })
      : supplier && supplier.paymentTermsDays === null
        ? t('dueDateNoTerms')
        : undefined;

  return (
    <>
      <form onSubmit={handleSubmit} noValidate>
        <FormActionBar
          back={
            <Button asChild variant="ghost" className="gap-1.5 px-2">
              <Link href={billHref}>
                <ArrowLeft size={16} aria-hidden="true" />
                {editing ? t('backToBill') : tBills('backToList')}
              </Link>
            </Button>
          }
          save={
            <Button
              type="submit"
              loading={save.isPending}
              loadingText={t('saving')}
              disabled={noProfiles}
            >
              {editing ? t('saveChanges') : t('save')}
            </Button>
          }
          discard={
            <Button type="button" variant="ghost" onClick={() => (dirty ? setConfirmLeave(true) : leave())}>
              {t('discard')}
            </Button>
          }
          saveState={dirty ? 'dirty' : editing ? 'clean' : 'new'}
          saveStateLabels={{ new: tForm('new'), dirty: tForm('dirty'), clean: tForm('clean') }}
          lifecycle={
            <LifecycleStepper
              steps={BILL_STAGES.map((stage) => ({
                key: stage,
                label: stage === 'POSTED' ? tPosting('POSTED') : tStatus(stage),
              }))}
              current="DRAFT"
              stepOfLabel={(n, total) => tBills('stepOf', { n, total })}
            />
          }
        />

        <div className="space-y-8">
          <div ref={summaryRef} className="scroll-mt-32">
            {showSummary ? <FormErrorSummary errors={summaryErrors} formErrors={formErrors} /> : null}
          </div>

          <div>
            <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
              {tBills('eyebrow')}
            </p>
            <h2 className="mt-1 text-display font-semibold tracking-tight text-foreground">{title}</h2>
            <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">
              {editing ? t('editIntro') : t('intro')}
            </p>
          </div>

          {/* The clerk correcting a returned bill needs the reason in front of them, not a click
              away on the bill page. */}
          {initialBill?.returnReason ? (
            <Notice tone="attention" title={tBills('notice.returnedWhileEditing')}>
              {initialBill.returnReason}
            </Notice>
          ) : null}

          {noProfiles ? (
            <Alert variant="error" title={tBills('noProfilesTitle')} messages={[tBills('noProfilesBody')]} />
          ) : null}

          <RadioGroup<BillKind>
            label={t('kindLabel')}
            name="bill-kind"
            variant="card"
            required
            value={kind}
            onChange={setKind}
            options={[
              {
                value: 'po',
                label: t('kindPo'),
                description: t('kindPoDescription'),
                icon: <ClipboardCheck size={16} />,
              },
              {
                value: 'direct',
                label: t('kindDirect'),
                description: t('kindDirectDescription'),
                icon: <Receipt size={16} />,
              },
            ]}
          />

          <FormGroup title={t('detailsTitle')} description={t('detailsDescription')}>
            <FormField htmlFor={IDS.supplier} label={t('supplier')} required error={shownHeader('supplier')}>
              <SupplierPicker id={IDS.supplier} value={supplierId} onChange={handleSupplierChange} required />
            </FormField>

            <FormField
              htmlFor={IDS.invoiceNumber}
              label={t('invoiceNumber')}
              required
              hint={t('invoiceNumberHint')}
              error={shownHeader('invoiceNumber')}
              warning={
                duplicate
                  ? t('duplicate', {
                      number: invoiceNumber.trim(),
                      bill: duplicate.billNumber ?? t('aDraftBill'),
                    })
                  : undefined
              }
            >
              <Input
                id={IDS.invoiceNumber}
                value={invoiceNumber}
                onChange={(e) => {
                  setInvoiceNumber(e.target.value);
                  if (save.error) save.reset();
                }}
                maxLength={100}
                autoComplete="off"
              />
            </FormField>

            {kind === 'po' ? (
              <FormField
                htmlFor={IDS.purchaseOrder}
                label={t('purchaseOrder')}
                required
                hint={supplierId ? undefined : tPo('chooseSupplierFirst')}
                error={shownHeader('purchaseOrder')}
              >
                <PurchaseOrderPicker
                  id={IDS.purchaseOrder}
                  value={purchaseOrderId}
                  onChange={setPurchaseOrderId}
                  supplierId={supplierId || undefined}
                  disabled={!supplierId}
                  required
                />
              </FormField>
            ) : (
              <ProjectField value={projectChoice} onChange={handleProjectChange} error={shownHeader('project')} />
            )}
          </FormGroup>

          <FormGroup title={t('datesTitle')} description={t('datesDescription')}>
            <FormField htmlFor={IDS.billDate} label={t('billDate')} required error={shownHeader('billDate')}>
              <DatePicker id={IDS.billDate} value={billDate} onChange={handleBillDateChange} />
            </FormField>
            <FormField
              htmlFor={IDS.dueDate}
              label={t('dueDate')}
              required
              hint={dueDateHint}
              error={shownHeader('dueDate')}
            >
              <DatePicker
                id={IDS.dueDate}
                value={dueDate}
                onChange={(next) => {
                  setDueDate(next);
                  setDueDateTerms(null);
                }}
              />
            </FormField>
          </FormGroup>

          <section className="space-y-4" aria-labelledby="bill-lines-heading">
            <div className="border-b border-border pb-2">
              <h2 id="bill-lines-heading" className="text-body font-semibold text-foreground">
                {t('linesTitle')}
              </h2>
              <p className="text-caption text-muted-foreground">
                {kind === 'po' ? t('linesPoDescription') : t('linesDirectDescription')}
              </p>
            </div>

            {kind === 'po' ? (
              poResolving ? (
                <div role="status" aria-live="polite">
                  <span className="sr-only">{tCommon('loading')}</span>
                  <div className="h-24 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
                </div>
              ) : finds ? (
                <>
                  <SystemFinds finds={finds} locale={locale} />
                  <PoLinesEditor
                    rows={poRows}
                    options={options}
                    locale={locale}
                    errors={cellErrors}
                    onChange={updatePo}
                  />
                </>
              ) : poNotBillable ? (
                <Alert variant="warning" messages={[tPo('poNotBillable')]} />
              ) : (
                <p className="text-body-sm text-muted-foreground">{t('choosePoFirst')}</p>
              )
            ) : projectChoice && projectChoice !== NO_PROJECT ? (
              <ProjectCostLines projectId={projectChoice}>
                {(costLines) => (
                  <DirectLinesEditor
                    rows={directLines}
                    options={options}
                    costLines={costLines}
                    locale={locale}
                    errors={cellErrors}
                    onChange={updateDirect}
                    onAdd={addDirectLine}
                    onRemove={(index) => setDirectLines((prev) => prev.filter((_, i) => i !== index))}
                  />
                )}
              </ProjectCostLines>
            ) : (
              <DirectLinesEditor
                rows={directLines}
                options={options}
                costLines={null}
                locale={locale}
                errors={cellErrors}
                onChange={updateDirect}
                onAdd={addDirectLine}
                onRemove={(index) => setDirectLines((prev) => prev.filter((_, i) => i !== index))}
              />
            )}
          </section>

          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
            <p className="text-caption text-muted-foreground md:pt-1">{t('totalsNote')}</p>
            <TotalsBlock
              rows={[
                { label: tBills('subtotal'), value: money(totals.subtotal) },
                { label: tBills('vat'), value: money(totals.vat) },
              ]}
              total={{ label: tBills('totalAmount'), value: money(totals.total) }}
            />
          </div>
        </div>
      </form>

      {confirmLeave ? (
        <ConfirmActionDialog
          title={tCommon('unsavedChanges.title')}
          description={tCommon('unsavedChanges.body')}
          confirmLabel={tCommon('unsavedChanges.leave')}
          isPending={false}
          onConfirm={leave}
          onDismiss={() => setConfirmLeave(false)}
        />
      ) : null}
    </>
  );
}

// ─── Project (direct path) ────────────────────────────────────────────────────

/**
 * The bill's project, or an explicit "no project". Required rather than optional: an empty
 * answer and "this is overhead" must not look the same on a bill whose cost posts to a project.
 */
function ProjectField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
}) {
  const t = useTranslations('procurement.bills.create');
  const tc = useTranslations('procurement.common');
  const projects = useProjects();

  return (
    <FormField
      htmlFor={IDS.project}
      label={t('project')}
      required
      hint={value === NO_PROJECT ? t('projectHint') : undefined}
      error={error ?? (projects.isError ? tc('loadFailed') : undefined)}
    >
      <Select
        id={IDS.project}
        value={value}
        onChange={onChange}
        disabled={projects.isLoading}
        searchable
      >
        <option value="" disabled>
          {t('projectPlaceholder')}
        </option>
        <option value={NO_PROJECT}>{t('projectNone')}</option>
        {(projects.data ?? []).map((project) => (
          <option key={project.id} value={project.id}>
            {project.code} · {project.name}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

/**
 * Loads what a project line can be charged to — the baselined BOQ's leaf items and the project
 * cost categories — only once a project is chosen, so no BOQ read is made for an overhead bill.
 */
function ProjectCostLines({
  projectId,
  children,
}: {
  projectId: string;
  children: (options: CostLineOptions) => React.ReactNode;
}) {
  const nodes = useProjectCostNodes(projectId);
  const categories = useSpendCategories();

  const options = useMemo<CostLineOptions>(
    () => ({
      nodes: nodes.leafNodes.map((node) => ({
        value: `node:${node.id}`,
        label: `${node.code} · ${node.description}`,
      })),
      categories: (categories.data ?? [])
        .filter((c) => c.status === 'ACTIVE')
        .map((c) => ({ value: `category:${c.id}`, label: `${c.code} · ${c.name}` })),
      loading: nodes.loading || categories.isLoading,
    }),
    [nodes.leafNodes, nodes.loading, categories.data, categories.isLoading],
  );

  return <>{children(options)}</>;
}

// ─── System finds (PO path) ───────────────────────────────────────────────────

function SystemFinds({
  finds,
  locale,
}: {
  finds: NonNullable<ReturnType<typeof systemFinds>>;
  locale: 'en';
}) {
  const tPo = useTranslations('procurement.bills.po');

  return (
    <div className="rounded-panel border border-border bg-surface-subtle px-4 py-3">
      <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">{tPo('systemFinds')}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
        <span className="font-mono font-medium text-foreground">{finds.poNumber}</span>
        {finds.noReceipts ? (
          <span className="text-muted-foreground">· {tPo('noReceipts')}</span>
        ) : (
          finds.postedReceipts.map((r) => (
            <span key={r.id} className="text-muted-foreground">
              · <span className="font-mono text-foreground">{r.grnNumber}</span>{' '}
              <span className="tabular-nums">
                ({tPo('accepted', { qty: formatNumber(String(r.acceptedQuantity), locale) ?? '0' })})
              </span>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Line editors ─────────────────────────────────────────────────────────────

function ProfileSelect({
  id,
  value,
  options,
  locale,
  onChange,
}: {
  id: string;
  value: string;
  options: ExpenseProfile[];
  locale: 'en';
  onChange: (value: string) => void;
}) {
  const t = useTranslations('procurement.bills.create');
  return (
    <Select id={id} value={value} onChange={onChange}>
      <option value="" disabled>
        {t('profilePlaceholder')}
      </option>
      {options.map((profile) => (
        <option key={profile.code} value={profile.code}>
          {profile.name} · {profile.account.code} {accountName(profile.account, locale)}
        </option>
      ))}
    </Select>
  );
}

/**
 * The line's net. Empty, it follows `quantity × unit price`, shown as the placeholder; typing
 * an amount overrides it — the supplier's invoice is what posts — and a note under the row says
 * by how much it differs (Eng Ahmed, 2026-09-27).
 */
function AmountCell({
  id,
  line,
  onChange,
}: {
  id: string;
  line: NetFigures;
  onChange: (netOverride: string) => void;
}) {
  const t = useTranslations('procurement.bills.create');
  const computed = lineAmountMinor(line);
  const overridden = line.netOverride.trim() !== '';
  return (
    <div className="space-y-1">
      <MoneyInput
        id={id}
        value={line.netOverride}
        onValueChange={onChange}
        placeholder={computed === null ? undefined : formatThousands(fromMinorUnits(computed, MONEY_SCALE))}
        autoComplete="off"
      />
      {overridden ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="w-full text-end text-caption text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('resetNet')}
        </button>
      ) : null}
    </div>
  );
}

/** "Amount is $95.00 more than 200 × $9.50 ($1,900.00)." — or null when the net is the product. */
function netVarianceText(
  line: NetFigures,
  locale: 'en',
  t: ReturnType<typeof useTranslations<'procurement.bills.create'>>,
): string | null {
  const variance = netVariance(line);
  if (!variance) return null;
  const money = (minor: number) => formatMoney(fromMinorUnits(minor, MONEY_SCALE), 'USD', locale) ?? '';
  return t('netDiffers', {
    diff: money(Math.abs(variance.diffMinor)),
    direction: variance.diffMinor > 0 ? 'more' : 'less',
    qty: formatNumber(line.quantity, locale) ?? line.quantity,
    price: formatMoney(line.unitPrice, 'USD', locale) ?? line.unitPrice,
    computed: money(variance.computedMinor),
  });
}

function PoLinesEditor({
  rows,
  options,
  locale,
  errors,
  onChange,
}: {
  rows: PoLineDraft[];
  options: ExpenseProfile[];
  locale: 'en';
  errors: (index: number) => Partial<Record<string, string>> | undefined;
  onChange: (index: number, patch: Partial<PoLineDraft>) => void;
}) {
  const t = useTranslations('procurement.bills.create');

  const quantity = (value: string, unit: string | null) =>
    `${formatNumber(value, locale) ?? '—'}${unit ? ` ${unit}` : ''}`;

  const columns: LineColumn<PoLineDraft>[] = [
    {
      key: 'description',
      header: t('col.item'),
      width: 'minmax(0,2fr)',
      cell: (row) => (
        <div className="min-w-0 py-2">
          <p className="text-body-sm font-medium text-foreground">{row.description}</p>
          {/* Inherited cost target (D7) — named, read-only, never re-coded on the bill. */}
          <ClassificationChips className="mt-1 flex flex-wrap gap-1.5" costTargetLabel={row.costTargetLabel} />
        </div>
      ),
      hideOnCard: true,
    },
    {
      key: 'ordered',
      header: t('col.ordered'),
      width: '6rem',
      align: 'end',
      cell: (row) => <p className="py-2 text-body-sm tabular-nums text-muted-foreground">{quantity(row.ordered, row.unit)}</p>,
    },
    {
      key: 'received',
      header: t('col.received'),
      width: '6rem',
      align: 'end',
      cell: (row) => (
        <p className="py-2 text-body-sm tabular-nums text-muted-foreground">
          {row.received ? quantity(fromMinorUnits(row.received.acceptedMinor, QUANTITY_SCALE), row.unit) : '—'}
        </p>
      ),
    },
    {
      key: 'quantity',
      header: t('col.billedQty'),
      required: true,
      width: '8.5rem',
      controlId: (i) => lineId(i, 'quantity'),
      cell: (row, i) => (
        <QuantityInput
          id={lineId(i, 'quantity')}
          value={row.quantity}
          unit={row.unit ?? undefined}
          onValueChange={(quantity) => onChange(i, { quantity })}
          autoComplete="off"
        />
      ),
    },
    {
      key: 'unitPrice',
      header: t('col.unitPrice'),
      required: true,
      width: '8.5rem',
      controlId: (i) => lineId(i, 'unitPrice'),
      cell: (row, i) => (
        <MoneyInput
          id={lineId(i, 'unitPrice')}
          value={row.unitPrice}
          onValueChange={(unitPrice) => onChange(i, { unitPrice })}
          autoComplete="off"
        />
      ),
    },
    {
      key: 'profile',
      header: t('col.expenseProfile'),
      required: true,
      width: 'minmax(0,1.5fr)',
      controlId: (i) => lineId(i, 'profile'),
      cell: (row, i) => (
        <ProfileSelect
          id={lineId(i, 'profile')}
          value={row.expenseProfileCode}
          options={options}
          locale={locale}
          onChange={(expenseProfileCode) => onChange(i, { expenseProfileCode })}
        />
      ),
    },
    {
      key: 'vat',
      header: t('col.vat'),
      required: true,
      width: '7.5rem',
      controlId: (i) => lineId(i, 'vat'),
      cell: (row, i) => (
        <MoneyInput
          id={lineId(i, 'vat')}
          value={row.vatAmount}
          onValueChange={(vatAmount) => onChange(i, { vatAmount })}
          autoComplete="off"
        />
      ),
    },
    {
      key: 'amount',
      header: t('col.amount'),
      width: '8.5rem',
      align: 'end',
      controlId: (i) => lineId(i, 'amount'),
      cell: (row, i) => (
        <AmountCell id={lineId(i, 'amount')} line={row} onChange={(netOverride) => onChange(i, { netOverride })} />
      ),
    },
  ];

  return (
    <LineItemsEditor<PoLineDraft>
      label={t('linesLabel')}
      rows={rows}
      rowKey={(row) => row.poLineId}
      columns={columns}
      errors={errors}
      cardTitle={(row, i) => t('lineTitleNamed', { n: i + 1, name: row.description })}
      note={(row) => {
        const texts: string[] = [];
        const over = overBilling(row);
        if (over) {
          const qty = formatNumber(fromMinorUnits(over.excessMinor, QUANTITY_SCALE), locale) ?? '';
          const unit = row.unit ?? '';
          texts.push(
            over.kind === 'ordered'
              ? t('overOrdered', { qty, unit })
              : over.grnNumbers.length > 0
                ? t('overReceived', { qty, unit, grn: over.grnNumbers.join(', ') })
                : t('overReceivedNothing', { qty, unit }),
          );
        }
        const variance = netVarianceText(row, locale, t);
        if (variance) texts.push(variance);
        return texts.length > 0 ? { tone: 'warning', text: texts.join(' ') } : null;
      }}
    />
  );
}

function DirectLinesEditor({
  rows,
  options,
  costLines,
  locale,
  errors,
  onChange,
  onAdd,
  onRemove,
}: {
  rows: DirectLineDraft[];
  options: ExpenseProfile[];
  /** Null when the bill has no project — the Cost line column does not apply. */
  costLines: CostLineOptions | null;
  locale: 'en';
  errors: (index: number) => Partial<Record<string, string>> | undefined;
  onChange: (index: number, patch: Partial<DirectLineDraft>) => void;
  onAdd: (focus: boolean) => void;
  onRemove: (index: number) => void;
}) {
  const t = useTranslations('procurement.bills.create');

  const columns: LineColumn<DirectLineDraft>[] = [
    {
      key: 'description',
      header: t('col.description'),
      required: true,
      width: 'minmax(0,2fr)',
      controlId: (i) => lineId(i, 'description'),
      cell: (row, i) => (
        <Input
          id={lineId(i, 'description')}
          value={row.description}
          onChange={(e) => onChange(i, { description: e.target.value })}
          onKeyDown={(e) => {
            // Enter on the last line's description starts the next line, as in a spreadsheet.
            if (e.key === 'Enter' && i === rows.length - 1) {
              e.preventDefault();
              onAdd(true);
            }
          }}
          maxLength={500}
          autoComplete="off"
        />
      ),
    },
    {
      key: 'profile',
      header: t('col.expenseProfile'),
      required: true,
      width: 'minmax(0,1.5fr)',
      controlId: (i) => lineId(i, 'profile'),
      cell: (row, i) => (
        <ProfileSelect
          id={lineId(i, 'profile')}
          value={row.expenseProfileCode}
          options={options}
          locale={locale}
          onChange={(expenseProfileCode) => onChange(i, { expenseProfileCode })}
        />
      ),
    },
    ...(costLines
      ? [
          {
            key: 'costLine',
            header: t('col.costLine'),
            required: true,
            width: 'minmax(0,1.5fr)',
            controlId: (i: number) => lineId(i, 'costLine'),
            cell: (row: DirectLineDraft, i: number) => (
              <CostLineSelect
                id={lineId(i, 'costLine')}
                value={row.costLine}
                options={costLines}
                onChange={(costLine) => onChange(i, { costLine })}
              />
            ),
          } satisfies LineColumn<DirectLineDraft>,
        ]
      : []),
    {
      key: 'quantity',
      header: t('col.qty'),
      required: true,
      width: '6.5rem',
      controlId: (i) => lineId(i, 'quantity'),
      cell: (row, i) => (
        <QuantityInput
          id={lineId(i, 'quantity')}
          value={row.quantity}
          onValueChange={(quantity) => onChange(i, { quantity })}
          autoComplete="off"
        />
      ),
    },
    {
      key: 'unitPrice',
      header: t('col.unitPrice'),
      required: true,
      width: '8.5rem',
      controlId: (i) => lineId(i, 'unitPrice'),
      cell: (row, i) => (
        <MoneyInput
          id={lineId(i, 'unitPrice')}
          value={row.unitPrice}
          onValueChange={(unitPrice) => onChange(i, { unitPrice })}
          autoComplete="off"
        />
      ),
    },
    {
      key: 'vat',
      header: t('col.vat'),
      required: true,
      width: '7.5rem',
      controlId: (i) => lineId(i, 'vat'),
      cell: (row, i) => (
        <MoneyInput
          id={lineId(i, 'vat')}
          value={row.vatAmount}
          onValueChange={(vatAmount) => onChange(i, { vatAmount })}
          autoComplete="off"
        />
      ),
    },
    {
      key: 'amount',
      header: t('col.amount'),
      width: '8.5rem',
      align: 'end',
      controlId: (i) => lineId(i, 'amount'),
      cell: (row, i) => (
        <AmountCell id={lineId(i, 'amount')} line={row} onChange={(netOverride) => onChange(i, { netOverride })} />
      ),
    },
  ];

  return (
    <LineItemsEditor<DirectLineDraft>
      label={t('linesLabel')}
      rows={rows}
      rowKey={(row) => row.key}
      columns={columns}
      errors={errors}
      note={(row) => {
        const variance = netVarianceText(row, locale, t);
        return variance ? { tone: 'warning', text: variance } : null;
      }}
      cardTitle={(row, i) =>
        row.description.trim()
          ? t('lineTitleNamed', { n: i + 1, name: row.description.trim() })
          : t('lineTitle', { n: i + 1 })
      }
      onAdd={() => onAdd(false)}
      addLabel={t('addLine')}
      onRemove={rows.length > 1 ? onRemove : undefined}
      removeLabel={(i) => t('removeLine', { n: i + 1 })}
    />
  );
}

function CostLineSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string;
  options: CostLineOptions;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('procurement.bills.create');
  const empty = !options.loading && options.nodes.length === 0 && options.categories.length === 0;

  return (
    <>
      <Select id={id} value={value} onChange={onChange} disabled={options.loading || empty} searchable>
        <option value="" disabled>
          {options.loading ? t('costLineLoading') : t('costLinePlaceholder')}
        </option>
        {options.nodes.length > 0 ? (
          <optgroup label={t('costLineBoq')}>
            {options.nodes.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ) : null}
        {options.categories.length > 0 ? (
          <optgroup label={t('costLineCategories')}>
            {options.categories.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>
      {empty ? <p className="mt-1 text-caption text-muted-foreground">{t('costLineNone')}</p> : null}
    </>
  );
}
