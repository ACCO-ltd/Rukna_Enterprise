'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  DatePicker,
  FormField,
  Input,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  LtrValue,
  cn,
} from '@erp/ui';

import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';
import { useFileUpload } from '@/features/files/hooks/use-file-upload';
import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { useUsers } from '@/features/users/hooks/use-users';

import {
  useAttachPoRevision,
  useConfirmPurchaseOrder,
  useCreateAdvanceReturn,
  useCreateBuyerAdvance,
  useCreateEvidenceAllocation,
  useGoodsReceipts,
  usePoRevisionAttachments,
  usePurchaseOrder,
  usePurchaseOrderSettlement,
} from '../../hooks/use-procurement';
import { moneyToApi } from '../../quantities';
import { activeRevision, revisionTotalMinor } from '../../quantities';
import type {
  BuyerAdvanceReturnMethod,
  GoodsReceipt,
  PoExceptionType,
  PoFundingStatus,
  PoLineReceivingStatus,
  PoReceivingStatus,
  PoSettlementStatus,
  PurchaseOrder,
  PurchaseOrderRevision,
  PurchaseOrderSettlement,
} from '../../types';
import { ClassificationChips } from '../classification-chips';
import { PoAmendSheet } from '../po-amend-sheet';
import { ProcurementStatusBadge } from '../procurement-badges';
import { SectionPanel } from './section-panel';

type Tab = 'items' | 'funding' | 'receiving' | 'settlement';

// ─── Shell ───────────────────────────────────────────────────────────────────────

export function PurchaseDetailShell({
  projectId,
  poId,
}: {
  projectId: string;
  poId: string;
}) {
  const t = useTranslations('procurement.project.purchase');
  const tPo = useTranslations('procurement.po');
  const locale = useLocale() as 'en';

  const [tab, setTab] = useState<Tab>('items');
  const [amending, setAmending] = useState(false);

  const po = usePurchaseOrder(poId);
  const confirm = useConfirmPurchaseOrder();

  if (po.isPending) return <Skeleton className="h-96 w-full" />;
  if (po.isError || !po.data) {
    return (
      <Alert variant="error" title={t('loadFailed')} messages={[]}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void po.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  const order: PurchaseOrder = po.data;
  const active = activeRevision(order.revisions);
  const draft = order.revisions.find((r) => r.status === 'DRAFT') ?? null;
  const current =
    active ??
    draft ??
    [...order.revisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0] ??
    null;

  const isDraftPo = order.status === 'DRAFT';
  const isOpen = order.status === 'OPEN';
  const canAmend = isOpen && !draft && Boolean(active);

  const TABS: { key: Tab; label: string }[] = [
    { key: 'items', label: t('tabs.items') },
    { key: 'funding', label: t('tabs.funding') },
    { key: 'receiving', label: t('tabs.receiving') },
    { key: 'settlement', label: t('tabs.settlement') },
  ];

  return (
    <div className="space-y-5">
      {/* Back link */}
      <Link
        href={`/projects/${projectId}/procurement/purchases`}
        className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
      >
        <ChevronStartIcon />
        {t('backToPurchases')}
      </Link>

      {/* PO header */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
        <div className="px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <LtrValue className="font-mono text-xs font-medium text-muted-foreground">
              {order.poNumber}
            </LtrValue>
            <ProcurementStatusBadge status={order.status} />
          </div>
          <h2 className="mt-2 text-[22px] font-bold leading-tight tracking-[-0.02em] text-foreground sm:text-[24px]">
            {order.supplier?.name ?? order.poNumber}
          </h2>
          {current ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {tPo('revisionOf', {
                number: current.revisionNumber,
                total: order.revisions.length,
              })}
            </p>
          ) : null}
        </div>

        {/* Action footer */}
        {(isDraftPo || isOpen) && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border px-5 py-3 sm:px-6">
            {draft && (
              <Button
                type="button"
                size="sm"
                disabled={confirm.isPending}
                onClick={() => confirm.mutate(poId)}
              >
                {isDraftPo ? t('confirm') : t('confirmRevision')}
              </Button>
            )}
            {canAmend && (
              <Button type="button" size="sm" variant="outline" onClick={() => setAmending(true)}>
                {tPo('amend')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Tab nav */}
      <nav aria-label={t('tabsLabel')}>
        <div className="flex gap-0 border-b border-border">
          {TABS.map((item) => {
            const isActive = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={cn(
                  'flex min-h-11 items-center px-4 py-2 text-body-sm font-medium transition-colors',
                  'border-b-2 -mb-px',
                  isActive
                    ? 'border-brand-primary text-brand-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Tab content */}
      {tab === 'items' && (
        <ItemsTab
          order={order}
          current={current}
          locale={locale}
        />
      )}
      {tab === 'funding' && <FundingTab poId={poId} locale={locale} isOpen={isOpen} />}
      {tab === 'receiving' && <ReceivingTab poId={poId} locale={locale} isOpen={isOpen} />}
      {tab === 'settlement' && <SettlementTab poId={poId} order={order} locale={locale} />}

      {/* Amend sheet */}
      {amending && active ? (
        <PoAmendSheet order={order} source={active} onClose={() => setAmending(false)} />
      ) : null}
    </div>
  );
}

// ─── Items tab ───────────────────────────────────────────────────────────────────

function ItemsTab({
  order,
  current,
  locale,
}: {
  order: PurchaseOrder;
  current: PurchaseOrderRevision | null;
  locale: 'en';
}) {
  const t = useTranslations('procurement.project.purchase');
  const tc = useTranslations('procurement.common');
  const tPo = useTranslations('procurement.po');
  const tItems = useTranslations('procurement.project.purchase.items');
  const attachments = usePoRevisionAttachments(order.id);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useFileUpload();
  const attach = useAttachPoRevision(order.id);
  const [attachError, setAttachError] = useState<string | null>(null);

  // Only allow attach when there is a DRAFT revision (becomes IMMUTABLE on confirm).
  const hasDraftRevision = current?.status === 'DRAFT';

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachError(null);
    try {
      const fileId = await upload.mutateAsync(file);
      await attach.mutateAsync({ platformFileId: fileId as string, purpose: 'QUOTATION' });
    } catch {
      setAttachError(tItems('attachFailed'));
    } finally {
      e.target.value = '';
    }
  }

  if (!current) {
    return <Alert variant="info" messages={[t('noRevision')]} />;
  }

  const lines = current.lines ?? [];
  const totalMinor = revisionTotalMinor(lines);
  const hasQuotation = current.quotationRef || current.quotationDate || current.quotedAmount;

  return (
    <div className="space-y-4">
      {/* Quotation bar */}
      {hasQuotation ? (
        <SectionPanel title={t('quotation.bar')}>
          <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
            <div className="bg-surface px-4 py-3">
              <dt className="text-xs font-medium text-muted-foreground">{t('quotation.ref')}</dt>
              <dd className="mt-1 text-sm font-semibold text-foreground">
                {current.quotationRef ?? t('quotation.noRef')}
              </dd>
            </div>
            <div className="bg-surface px-4 py-3">
              <dt className="text-xs font-medium text-muted-foreground">{t('quotation.date')}</dt>
              <dd className="mt-1 text-sm font-semibold text-foreground">
                {current.quotationDate ? (formatDate(current.quotationDate, locale) ?? '—') : '—'}
              </dd>
            </div>
            <div className="bg-surface px-4 py-3">
              <dt className="text-xs font-medium text-muted-foreground">
                {t('quotation.quotedAmount')}
              </dt>
              <dd className="mt-1 text-sm font-semibold text-foreground">
                {current.quotedAmount
                  ? (formatMoney(current.quotedAmount, current.currencyCode, locale) ?? '—')
                  : '—'}
              </dd>
            </div>
          </dl>
        </SectionPanel>
      ) : null}

      {/* Revision lines */}
      <SectionPanel
        title={tc('lines')}
        bodyClassName="px-0 py-0"
        action={
          <LtrValue className="text-caption text-muted-foreground">
            {tPo('revisionTab', { number: current.revisionNumber })}
          </LtrValue>
        }
      >
        {lines.length === 0 ? (
          <p className="px-4 py-4 text-body-sm text-muted-foreground sm:px-5">
            {tc('noResults')}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {lines.map((line) => (
                <li key={line.id} className="px-5 py-3 sm:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        <span className="me-2 tabular-nums text-muted-foreground">
                          {line.lineNumber}.
                        </span>
                        {line.material ? (
                          <span className="me-2 font-mono text-xs text-muted-foreground">
                            {line.material.code}
                          </span>
                        ) : null}
                        {line.description}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                        {formatNumber(line.orderedQuantity, locale)}{' '}
                        {line.uom?.symbol ?? line.uom?.code ?? ''} ×{' '}
                        {formatMoney(line.unitPrice, current.currencyCode, locale)}
                      </p>
                      <ClassificationChips
                        className="mt-2 flex flex-wrap items-center gap-1.5"
                        lineType={line.lineType}
                        spendCategoryName={line.spendCategory?.name ?? tPo('derivedOnIssue')}
                        costTargetLabel={
                          line.project && line.boqNode
                            ? `${line.project.code} · ${line.boqNode.code} ${line.boqNode.description}`
                            : null
                        }
                      />
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                      {formatMoney(line.extendedAmount, current.currencyCode, locale)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-border px-5 py-3 text-end sm:px-6">
              <span className="text-sm text-muted-foreground">{tc('total')}: </span>
              <span className="text-sm font-semibold tabular-nums">
                {formatMoney(
                  fromMinorUnits(totalMinor, MONEY_SCALE),
                  current.currencyCode,
                  locale,
                )}
              </span>
            </div>
          </>
        )}
      </SectionPanel>

      {/* Quotation attachments */}
      <SectionPanel
        title={t('attachments.title')}
        action={
          hasDraftRevision ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                aria-label={tItems('attachQuotation')}
                onChange={(e) => void handleFileChange(e)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={upload.isPending || attach.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {upload.isPending || attach.isPending ? tItems('uploading') : tItems('attachQuotation')}
              </Button>
            </>
          ) : null
        }
      >
        {attachError ? (
          <Alert variant="error" messages={[attachError]} />
        ) : null}
        {attachments.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : attachments.isError || !attachments.data?.length ? (
          <p className="text-body-sm text-muted-foreground">{t('attachments.none')}</p>
        ) : (
          <ul className="divide-y divide-border -mx-4 -my-3 sm:-mx-5">
            {attachments.data.map((att) => (
              <li key={att.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <div className="size-8 shrink-0 rounded border border-border bg-muted" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {att.file?.originalName ?? att.platformFileId}
                  </p>
                  {att.supplierRef ? (
                    <p className="text-xs text-muted-foreground">
                      {t('attachments.supplierRef')}: {att.supplierRef}
                    </p>
                  ) : null}
                </div>
                <Badge tone="neutral" className="ml-auto shrink-0">
                  {att.purpose}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </SectionPanel>

      {/* Link to org workspace for full history */}
      <p className="text-caption text-muted-foreground">
        {t('revisionHistory')} —{' '}
        <Link
          href={`/procurement/orders/${order.id}`}
          className="text-brand-primary hover:underline"
        >
          {t('viewInProcurement')}
        </Link>
      </p>
    </div>
  );
}

// ─── Advance card (per-advance interactive card with return + evidence forms) ─────

type AdvanceSummary = PurchaseOrderSettlement['advanceFunding']['advances'][number];
type BillOption = PurchaseOrderSettlement['directFunding']['bills'][number];

function AdvanceCard({
  adv,
  poId,
  isOpen,
  locale,
  banks,
  users,
  bills,
}: {
  adv: AdvanceSummary;
  poId: string;
  isOpen: boolean;
  locale: 'en';
  banks: { id: string; bankName: string; accountName: string; status: string }[];
  users: { id: string; firstName: string; lastName: string }[];
  bills: BillOption[];
}) {
  const t = useTranslations('procurement.project.purchase.funding');
  const tRet = useTranslations('procurement.project.purchase.funding.returnForm');
  const tEv = useTranslations('procurement.project.purchase.funding.evidenceForm');

  const createReturn = useCreateAdvanceReturn(adv.advanceId, poId);
  const createEvidence = useCreateEvidenceAllocation(adv.advanceId, poId);

  const hasOutstanding = Number(adv.outstanding) > 0;
  const id = adv.advanceId;

  const [showReturnForm, setShowReturnForm] = useState(false);
  const [retAmount, setRetAmount] = useState('');
  const [retMethod, setRetMethod] = useState<BuyerAdvanceReturnMethod>('CASH');
  const [retBankId, setRetBankId] = useState('');
  const [retReceivedBy, setRetReceivedBy] = useState('');
  const [retDate, setRetDate] = useState('');
  const [retRef, setRetRef] = useState('');
  const [retError, setRetError] = useState<string | null>(null);
  const [retShowErrors, setRetShowErrors] = useState(false);

  const [showEvidenceForm, setShowEvidenceForm] = useState(false);
  const [evBillId, setEvBillId] = useState('');
  const [evAmount, setEvAmount] = useState('');
  const [evError, setEvError] = useState<string | null>(null);
  const [evShowErrors, setEvShowErrors] = useState(false);

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  async function handleReturnSubmit() {
    setRetShowErrors(true);
    const amountMinor = parseMinorUnits(retAmount, MONEY_SCALE);
    const needsAccount = retMethod === 'BANK' || retMethod === 'MOBILE_MONEY';
    if (amountMinor === null || amountMinor <= 0 || !retReceivedBy || !retDate || (needsAccount && !retBankId)) return;
    setRetError(null);
    try {
      await createReturn.mutateAsync({
        amount: moneyToApi(amountMinor),
        returnMethod: retMethod,
        destinationBankAccountId: needsAccount ? retBankId : undefined,
        receivedBy: retReceivedBy,
        receivedAt: retDate,
        reference: retRef || undefined,
      });
      setShowReturnForm(false);
      setRetAmount(''); setRetMethod('CASH'); setRetBankId('');
      setRetReceivedBy(''); setRetDate(''); setRetRef('');
      setRetShowErrors(false);
    } catch {
      setRetError(tRet('submitFailed'));
    }
  }

  async function handleEvidenceSubmit() {
    setEvShowErrors(true);
    const amountMinor = parseMinorUnits(evAmount, MONEY_SCALE);
    if (!evBillId || amountMinor === null || amountMinor <= 0) return;
    setEvError(null);
    try {
      await createEvidence.mutateAsync({
        supplierBillId: evBillId,
        allocatedAmount: moneyToApi(amountMinor),
      });
      setShowEvidenceForm(false);
      setEvBillId(''); setEvAmount('');
      setEvShowErrors(false);
    } catch {
      setEvError(tEv('submitFailed'));
    }
  }

  return (
    <div className="border-b border-border px-4 py-4 last:border-b-0 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">{adv.recipientName}</p>
          <p className="text-xs text-muted-foreground">
            {t('advancedOn', { date: formatDate(adv.advancedAt, locale) ?? '—' })}
          </p>
        </div>
        <div className="text-end">
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {formatMoney(adv.amount, 'USD', locale)}
          </p>
          {hasOutstanding ? (
            <Badge tone="warning" className="mt-1">
              {t('outstanding')}: {formatMoney(adv.outstanding, 'USD', locale)}
            </Badge>
          ) : (
            <Badge tone="live" className="mt-1">
              {t('evidenceAllocated')}
            </Badge>
          )}
        </div>
      </div>

      {adv.evidenceAllocations.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t('evidenceLabel')}</p>
          <ul className="space-y-1">
            {adv.evidenceAllocations.map((ev) => (
              <li key={ev.billId} className="flex items-center justify-between text-xs text-foreground">
                <span className="font-mono">{ev.billNumber ?? '—'}</span>
                <span className="tabular-nums">{formatMoney(ev.allocatedAmount, 'USD', locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{t('noEvidence')}</p>
      )}

      {adv.returns.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t('returnsLabel')}</p>
          <ul className="space-y-1">
            {adv.returns.map((ret, i) => (
              <li key={i} className="flex items-center justify-between text-xs text-foreground">
                <span className="text-muted-foreground">
                  {t(`returnMethod.${ret.returnMethod}`)},{' '}
                  {formatDate(ret.receivedAt, locale) ?? '—'}
                </span>
                <span className="tabular-nums">{formatMoney(ret.amount, 'USD', locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isOpen && hasOutstanding && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setShowReturnForm((v) => !v);
              setShowEvidenceForm(false);
              if (!showReturnForm) setRetDate(today());
            }}
          >
            {t('recordReturn')}
          </Button>
          {bills.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setShowEvidenceForm((v) => !v);
                setShowReturnForm(false);
              }}
            >
              {t('linkEvidence')}
            </Button>
          )}
        </div>
      )}

      {showReturnForm && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          {retError ? <Alert variant="error" messages={[retError]} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              htmlFor={`ret-amount-${id}`}
              label={tRet('amount')}
              error={retShowErrors && (parseMinorUnits(retAmount, MONEY_SCALE) === null || (parseMinorUnits(retAmount, MONEY_SCALE) ?? 0) <= 0) ? tRet('amountRequired') : undefined}
            >
              <Input id={`ret-amount-${id}`} type="text" inputMode="decimal" placeholder="0.00" value={retAmount} onChange={(e) => setRetAmount(e.target.value)} />
            </FormField>
            <FormField htmlFor={`ret-method-${id}`} label={tRet('method')}>
              <Select id={`ret-method-${id}`} value={retMethod} onChange={(v) => { setRetMethod(v as BuyerAdvanceReturnMethod); setRetBankId(''); }}>
                <option value="CASH">{tRet('method_CASH')}</option>
                <option value="BANK">{tRet('method_BANK')}</option>
                <option value="MOBILE_MONEY">{tRet('method_MOBILE_MONEY')}</option>
              </Select>
            </FormField>
            {(retMethod === 'BANK' || retMethod === 'MOBILE_MONEY') && (
              <FormField
                htmlFor={`ret-bank-${id}`}
                label={tRet('bankAccount')}
                error={retShowErrors && !retBankId ? tRet('accountRequired') : undefined}
              >
                <Select id={`ret-bank-${id}`} value={retBankId} onChange={(v) => setRetBankId(v)}>
                  <option value="">{tRet('selectAccount')}</option>
                  {banks.filter((b) => b.status === 'ACTIVE').map((b) => (
                    <option key={b.id} value={b.id}>{b.accountName} — {b.bankName}</option>
                  ))}
                </Select>
              </FormField>
            )}
            <FormField
              htmlFor={`ret-by-${id}`}
              label={tRet('receivedBy')}
              error={retShowErrors && !retReceivedBy ? tRet('receivedByRequired') : undefined}
            >
              <Select id={`ret-by-${id}`} value={retReceivedBy} onChange={(v) => setRetReceivedBy(v)}>
                <option value="">{tRet('selectUser')}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                ))}
              </Select>
            </FormField>
            <FormField
              htmlFor={`ret-date-${id}`}
              label={tRet('date')}
              error={retShowErrors && !retDate ? tRet('dateRequired') : undefined}
            >
              <DatePicker id={`ret-date-${id}`} value={retDate} onChange={(v) => setRetDate(v)} />
            </FormField>
            <FormField htmlFor={`ret-ref-${id}`} label={tRet('reference')}>
              <Input id={`ret-ref-${id}`} value={retRef} onChange={(e) => setRetRef(e.target.value)} />
            </FormField>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => { setShowReturnForm(false); setRetShowErrors(false); setRetError(null); }}>
              {tRet('cancel')}
            </Button>
            <Button type="button" size="sm" disabled={createReturn.isPending} onClick={() => void handleReturnSubmit()}>
              {tRet('submit')}
            </Button>
          </div>
        </div>
      )}

      {showEvidenceForm && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          {evError ? <Alert variant="error" messages={[evError]} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              htmlFor={`ev-bill-${id}`}
              label={tEv('bill')}
              error={evShowErrors && !evBillId ? tEv('billRequired') : undefined}
            >
              <Select id={`ev-bill-${id}`} value={evBillId} onChange={(v) => setEvBillId(v)}>
                <option value="">{tEv('selectBill')}</option>
                {bills.map((b) => (
                  <option key={b.billId} value={b.billId}>{b.billNumber ?? b.billId}</option>
                ))}
              </Select>
            </FormField>
            <FormField
              htmlFor={`ev-amount-${id}`}
              label={tEv('amount')}
              error={evShowErrors && (parseMinorUnits(evAmount, MONEY_SCALE) === null || (parseMinorUnits(evAmount, MONEY_SCALE) ?? 0) <= 0) ? tEv('amountRequired') : undefined}
            >
              <Input id={`ev-amount-${id}`} type="text" inputMode="decimal" placeholder="0.00" value={evAmount} onChange={(e) => setEvAmount(e.target.value)} />
            </FormField>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => { setShowEvidenceForm(false); setEvShowErrors(false); setEvError(null); }}>
              {tEv('cancel')}
            </Button>
            <Button type="button" size="sm" disabled={createEvidence.isPending} onClick={() => void handleEvidenceSubmit()}>
              {tEv('submit')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Funding tab ─────────────────────────────────────────────────────────────────

function FundingTab({ poId, locale, isOpen }: { poId: string; locale: 'en'; isOpen: boolean }) {
  const t = useTranslations('procurement.project.purchase.funding');
  const tForm = useTranslations('procurement.project.purchase.funding.advanceForm');
  const settlement = usePurchaseOrderSettlement(poId);
  const createAdvance = useCreateBuyerAdvance(poId);
  const banks = useBankAccounts();
  const users = useUsers();
  const [showAdvanceForm, setShowAdvanceForm] = useState(false);
  const [advRecipient, setAdvRecipient] = useState('');
  const [advAmount, setAdvAmount] = useState('');
  const [advMethod, setAdvMethod] = useState<'BANK' | 'MOBILE_MONEY'>('BANK');
  const [advBankId, setAdvBankId] = useState('');
  const [advDate, setAdvDate] = useState('');
  const [advRef, setAdvRef] = useState('');
  const [advError, setAdvError] = useState<string | null>(null);
  const [advShowErrors, setAdvShowErrors] = useState(false);

  function today() { return new Date().toISOString().slice(0, 10); }

  async function handleAdvanceSubmit() {
    setAdvShowErrors(true);
    const amountMinor = parseMinorUnits(advAmount, MONEY_SCALE);
    if (!advRecipient || amountMinor === null || amountMinor <= 0 || !advBankId || !advDate) return;
    setAdvError(null);
    try {
      await createAdvance.mutateAsync({
        purchaseOrderId: poId,
        recipientUserId: advRecipient,
        amount: moneyToApi(amountMinor),
        currencyCode: 'USD',
        paymentMethod: advMethod,
        disbursementBankAccountId: advBankId,
        reference: advRef || undefined,
        advancedAt: advDate,
      });
      setShowAdvanceForm(false);
      setAdvRecipient(''); setAdvAmount(''); setAdvMethod('BANK');
      setAdvBankId(''); setAdvDate(''); setAdvRef('');
      setAdvShowErrors(false);
    } catch {
      setAdvError(tForm('submitFailed'));
    }
  }

  if (settlement.isPending) return <Skeleton className="h-64 w-full" />;
  if (settlement.isError || !settlement.data) {
    return (
      <Alert variant="error" title={t('loadFailed')} messages={[]}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void settlement.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  const s = settlement.data;

  return (
    <div className="space-y-4">
      {/* Funding status chip */}
      <div className="flex items-center gap-3">
        <FundingStatusBadge status={s.fundingStatus} />
      </div>

      {/* Direct payments */}
      <SectionPanel title={t('directTitle')} bodyClassName="px-0 py-0">
        {s.directFunding.allocations.length === 0 ? (
          <p className="px-4 py-4 text-body-sm text-muted-foreground sm:px-5">{t('directNone')}</p>
        ) : (
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('paymentRef')}</TableHead>
                  <TableHead>{t('date')}</TableHead>
                  <TableHead className="text-end">{t('amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.directFunding.allocations.map((alloc) => (
                  <TableRow key={alloc.paymentId}>
                    <TableCell className="font-mono text-caption text-foreground">
                      {alloc.paymentRef ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(alloc.allocationDate, locale) ?? '—'}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatMoney(alloc.allocatedAmount, 'USD', locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </SectionPanel>

      {/* Linked supplier bills */}
      <SectionPanel title={t('billsTitle')} bodyClassName="px-0 py-0">
        {s.directFunding.bills.length === 0 ? (
          <p className="px-4 py-4 text-body-sm text-muted-foreground sm:px-5">{t('billsNone')}</p>
        ) : (
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('billNumber')}</TableHead>
                  <TableHead className="text-end">{t('totalAmount')}</TableHead>
                  <TableHead className="text-end">{t('settledAmount')}</TableHead>
                  <TableHead className="text-end">{t('outstandingAmount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.directFunding.bills.map((bill) => (
                  <TableRow key={bill.billId}>
                    <TableCell className="font-mono text-caption text-foreground">
                      {bill.billNumber ?? '—'}
                    </TableCell>
                    <TableCell className="text-end tabular-nums text-muted-foreground">
                      {formatMoney(bill.totalAmount, 'USD', locale)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatMoney(bill.settledAmount, 'USD', locale)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatMoney(bill.outstandingAmount, 'USD', locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </SectionPanel>

      {/* Buyer advances */}
      <SectionPanel
        title={t('advancesTitle')}
        action={
          isOpen ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setShowAdvanceForm((v) => !v);
                if (!showAdvanceForm) setAdvDate(today());
              }}
            >
              {t('advanceToBuyer')}
            </Button>
          ) : null
        }
      >
        {showAdvanceForm && (
          <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            {advError ? <Alert variant="error" messages={[advError]} /> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                htmlFor="adv-recipient"
                label={tForm('recipient')}
                error={advShowErrors && !advRecipient ? tForm('recipientRequired') : undefined}
              >
                <Select id="adv-recipient" value={advRecipient} onChange={(v) => setAdvRecipient(v)}>
                  <option value="">{tForm('selectUser')}</option>
                  {(users.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField
                htmlFor="adv-amount"
                label={tForm('amount')}
                error={
                  advShowErrors &&
                  (parseMinorUnits(advAmount, MONEY_SCALE) === null ||
                    (parseMinorUnits(advAmount, MONEY_SCALE) ?? 0) <= 0)
                    ? tForm('amountRequired')
                    : undefined
                }
              >
                <Input
                  id="adv-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={advAmount}
                  onChange={(e) => setAdvAmount(e.target.value)}
                />
              </FormField>
              <FormField htmlFor="adv-method" label={tForm('paymentMethod')}>
                <Select
                  id="adv-method"
                  value={advMethod}
                  onChange={(v) => setAdvMethod(v as 'BANK' | 'MOBILE_MONEY')}
                >
                  <option value="BANK">{tForm('paymentMethod_BANK')}</option>
                  <option value="MOBILE_MONEY">{tForm('paymentMethod_MOBILE_MONEY')}</option>
                </Select>
              </FormField>
              <FormField
                htmlFor="adv-bank"
                label={tForm('bankAccount')}
                error={advShowErrors && !advBankId ? tForm('bankAccountRequired') : undefined}
              >
                <Select id="adv-bank" value={advBankId} onChange={(v) => setAdvBankId(v)}>
                  <option value="">{tForm('selectAccount')}</option>
                  {(banks.data ?? [])
                    .filter((b) => b.allowsPayments && b.status === 'ACTIVE')
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.accountName} — {b.bankName}
                      </option>
                    ))}
                </Select>
              </FormField>
              <FormField
                htmlFor="adv-date"
                label={tForm('date')}
                error={advShowErrors && !advDate ? tForm('dateRequired') : undefined}
              >
                <DatePicker id="adv-date" value={advDate} onChange={(v) => setAdvDate(v)} />
              </FormField>
              <FormField htmlFor="adv-ref" label={tForm('reference')}>
                <Input
                  id="adv-ref"
                  value={advRef}
                  onChange={(e) => setAdvRef(e.target.value)}
                  placeholder={tForm('referencePlaceholder')}
                />
              </FormField>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowAdvanceForm(false);
                  setAdvShowErrors(false);
                  setAdvError(null);
                }}
              >
                {tForm('cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={createAdvance.isPending}
                onClick={() => void handleAdvanceSubmit()}
              >
                {tForm('submit')}
              </Button>
            </div>
          </div>
        )}
        {s.advanceFunding.advances.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{t('advancesNone')}</p>
        ) : (
          <div className="-mx-4 -my-3 sm:-mx-5">
            {s.advanceFunding.advances.map((adv) => (
              <AdvanceCard
                key={adv.advanceId}
                adv={adv}
                poId={poId}
                isOpen={isOpen}
                locale={locale}
                banks={banks.data ?? []}
                users={users.data ?? []}
                bills={s.directFunding.bills}
              />
            ))}
          </div>
        )}
      </SectionPanel>
    </div>
  );
}

// ─── Receiving tab ───────────────────────────────────────────────────────────────

function ReceivingTab({
  poId,
  locale,
  isOpen,
}: {
  poId: string;
  locale: 'en';
  isOpen: boolean;
}) {
  const t = useTranslations('procurement.project.purchase.receiving');
  const settlement = usePurchaseOrderSettlement(poId);
  const grns = useGoodsReceipts({ purchaseOrderId: poId });

  if (settlement.isPending || grns.isPending) return <Skeleton className="h-64 w-full" />;
  if (settlement.isError || !settlement.data) {
    return (
      <Alert variant="error" title={t('loadFailed')} messages={[]}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void settlement.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  const s = settlement.data;
  const grnList: GoodsReceipt[] = grns.data ?? [];

  return (
    <div className="space-y-4">
      {/* Receiving status chip */}
      <div className="flex items-center gap-3">
        <ReceivingStatusBadge status={s.receivingStatus} />
      </div>

      {/* Per-line status grid */}
      <SectionPanel title={t('perLineTitle')} bodyClassName="px-0 py-0">
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('description')}</TableHead>
                <TableHead className="text-end">{t('ordered')}</TableHead>
                <TableHead className="text-end">{t('accepted')}</TableHead>
                <TableHead>{t('lineStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.receivingLines.map((line) => (
                <TableRow key={line.poLineId}>
                  <TableCell className="text-foreground">{line.description}</TableCell>
                  <TableCell className="text-end tabular-nums text-muted-foreground">
                    {formatNumber(line.orderedQuantity, locale)} {line.uomSymbol}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatNumber(line.acceptedQuantity, locale)} {line.uomSymbol}
                  </TableCell>
                  <TableCell>
                    <LineReceivingStatusBadge status={line.lineStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      </SectionPanel>

      {/* GRN events */}
      <SectionPanel
        title={t('grnTitle')}
        bodyClassName="px-0 py-0"
        action={
          isOpen ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/procurement/goods-receipts/new">{t('recordDelivery')}</Link>
            </Button>
          ) : null
        }
      >
        {grnList.length === 0 ? (
          <p className="px-4 py-4 text-body-sm text-muted-foreground sm:px-5">{t('grnNone')}</p>
        ) : (
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('grnNumber')}</TableHead>
                  <TableHead>{t('deliveryDate')}</TableHead>
                  <TableHead>{t('deliveryRef')}</TableHead>
                  <TableHead>{t('grnStatus')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {grnList.map((grn) => (
                  <TableRow key={grn.id}>
                    <TableCell className="font-mono text-caption text-foreground">
                      {grn.grnNumber}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(grn.deliveryDate, locale) ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {grn.deliveryNoteRef ?? '—'}
                    </TableCell>
                    <TableCell>
                      <ProcurementStatusBadge status={grn.status} />
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/procurement/goods-receipts/${grn.id}`}
                        className="text-xs font-medium text-brand-primary hover:underline"
                      >
                        {t('viewGrn')}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </SectionPanel>
    </div>
  );
}

// ─── Settlement tab ───────────────────────────────────────────────────────────────

function SettlementTab({
  poId,
  order,
  locale,
}: {
  poId: string;
  order: PurchaseOrder;
  locale: 'en';
}) {
  const t = useTranslations('procurement.project.purchase.settlement');
  const settlement = usePurchaseOrderSettlement(poId);

  if (settlement.isPending) return <Skeleton className="h-64 w-full" />;
  if (settlement.isError || !settlement.data) {
    return (
      <Alert variant="error" title={t('loadFailed')} messages={[]}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void settlement.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  const s = settlement.data;

  return (
    <div className="space-y-4">
      {/* Status + position sentence */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-panel)] sm:p-6">
        <div className="flex flex-wrap items-start gap-3">
          <SettlementStatusBadge status={s.settlementStatus} />
          {order.closedAt ? (
            <Badge tone="neutral">
              {t('autoClosedOn', { date: formatDate(order.closedAt, locale) ?? '' })}
            </Badge>
          ) : null}
        </div>
        <p className="mt-3 text-base text-foreground">{s.humanReadablePosition}</p>
      </div>

      {/* Reconciliation card */}
      <SectionPanel title={t('position')}>
        <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
          <ReconciliationRow
            label={t('ordered')}
            value={formatMoney(s.orderedAmount, 'USD', locale) ?? '—'}
          />
          <ReconciliationRow
            label={t('directFunded')}
            value={formatMoney(s.directFunding.totalAllocated, 'USD', locale) ?? '—'}
          />
          <ReconciliationRow
            label={t('advancesIssued')}
            value={formatMoney(s.advanceFunding.totalAdvanced, 'USD', locale) ?? '—'}
          />
          <ReconciliationRow
            label={t('outstandingAdvances')}
            value={formatMoney(s.advanceFunding.totalOutstanding, 'USD', locale) ?? '—'}
            highlight={Number(s.advanceFunding.totalOutstanding) > 0}
          />
        </dl>
      </SectionPanel>

      {/* Exceptions */}
      <SectionPanel title={t('exceptionsTitle')}>
        {s.exceptions.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{t('noExceptions')}</p>
        ) : (
          <ul className="space-y-3 -mx-4 -my-3 sm:-mx-5">
            {s.exceptions.map((ex, i) => (
              <li key={i} className="border-b border-border px-4 py-3 last:border-b-0 sm:px-5">
                <div className="flex flex-wrap items-start gap-2">
                  <ExceptionTypeBadge type={ex.type} />
                  <p className="text-sm text-foreground">{ex.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionPanel>
    </div>
  );
}

// ─── Small sub-components ─────────────────────────────────────────────────────────

function ReconciliationRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-1 text-sm font-semibold tabular-nums',
          highlight ? 'text-warning' : 'text-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function FundingStatusBadge({ status }: { status: PoFundingStatus }) {
  const t = useTranslations('procurement.project.purchase.funding.fundingStatus');
  const tones: Record<PoFundingStatus, 'neutral' | 'warning' | 'live'> = {
    NOT_FUNDED: 'neutral',
    PARTIALLY_FUNDED: 'warning',
    FUNDED: 'live',
  };
  return <Badge tone={tones[status]}>{t(status)}</Badge>;
}

function ReceivingStatusBadge({ status }: { status: PoReceivingStatus }) {
  const t = useTranslations('procurement.project.purchase.receiving.receivingStatus');
  const tones: Record<PoReceivingStatus, 'neutral' | 'warning' | 'live'> = {
    NOT_RECEIVED: 'neutral',
    PARTIALLY_RECEIVED: 'warning',
    RECEIVED: 'live',
  };
  return <Badge tone={tones[status]}>{t(status)}</Badge>;
}

function LineReceivingStatusBadge({ status }: { status: PoLineReceivingStatus }) {
  const t = useTranslations('procurement.project.purchase.receiving');
  const tones: Record<PoLineReceivingStatus, 'neutral' | 'warning' | 'live'> = {
    NOT_RECEIVED: 'neutral',
    PARTIALLY_RECEIVED: 'warning',
    RECEIVED: 'live',
  };
  return <Badge tone={tones[status]}>{t(`lineStatus.${status}`)}</Badge>;
}

function SettlementStatusBadge({ status }: { status: PoSettlementStatus }) {
  const t = useTranslations('procurement.project.purchase.settlement.settlementStatus');
  const tones: Record<PoSettlementStatus, 'neutral' | 'warning' | 'live'> = {
    OPEN: 'neutral',
    ACTION_REQUIRED: 'warning',
    SETTLED: 'live',
  };
  return <Badge tone={tones[status]}>{t(status)}</Badge>;
}

function ExceptionTypeBadge({ type }: { type: PoExceptionType }) {
  const t = useTranslations('procurement.project.purchase.settlement.exceptionType');
  return <Badge tone="warning">{t(type)}</Badge>;
}

// ─── Icon ─────────────────────────────────────────────────────────────────────────

function ChevronStartIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
