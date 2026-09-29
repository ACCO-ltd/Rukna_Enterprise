'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { CommercialSummaryResponse, SeparateChargeNode } from '@erp/types';
import {
  Alert,
  Badge,
  Button,
  DatePicker,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Input,
  Skeleton,
  ViewSwitcher,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';

import {
  useCreateSeparateChargeInvoice,
  useExtensionsOfTime,
  useProjectSeparateCharges,
  useVariations,
} from '../hooks/use-commercial';
import { useCommercialWorkspace } from '../hooks/use-commercial-workspace';
import { ExtensionOfTimeSection } from './extension-of-time-section';
import { VariationsTab } from './variations-tab';

type ContractChangesView = 'variations' | 'separate' | 'eot';

/**
 * Variations, the certified/invoiced trace by variation, Extension of Time, and Separate
 * Charges each answer a genuinely different question — none of their figures duplicate each
 * other — but stacked as four independently-bordered full-width sections they read as a long,
 * mostly-empty scroll for the common case of a contract with few or no changes yet. One titled
 * panel with a local tab switch keeps all four one click away without the sprawl, and each tab
 * carries a count so "is there anything here" stays visible without switching to it.
 *
 * `useVariations`/`useExtensionsOfTime`/`useProjectSeparateCharges` are called here (for the tab
 * badge counts, and — for variations — to pass down to the Extension of Time tab's "cite a VO"
 * checklist) as well as inside the tab bodies themselves; TanStack Query dedupes identical
 * queries, so this costs no extra round trip.
 */
export function ContractChangesPanel({
  projectId,
  contractId,
  summary,
}: {
  projectId: string;
  contractId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.contractMilestones.changes');
  const [view, setView] = useState<ContractChangesView>('variations');

  const variationsQuery = useVariations(contractId);
  const eotQuery = useExtensionsOfTime(contractId);
  const separateChargesQuery = useProjectSeparateCharges(projectId);

  const variations = variationsQuery.data?.variations ?? [];
  // Variations · Separate charges · Time, each with its count. "Certified & invoiced" is a
  // filter on variations, not a kind of change, so it is no longer a tab.
  const items = [
    { value: 'variations' as const, label: `${t('tabs.variations')} (${variations.length})` },
    {
      value: 'separate' as const,
      label: `${t('tabs.separate')} (${separateChargesQuery.data?.items.length ?? 0})`,
    },
    { value: 'eot' as const, label: `${t('tabs.time')} (${eotQuery.data?.extensions.length ?? 0})` },
  ];

  return (
    <section className="overflow-hidden rounded-panel border border-border bg-surface shadow-e1">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-h3 font-semibold text-foreground">{t('title')}</h2>
        <ViewSwitcher
          aria-label={t('title')}
          value={view}
          onValueChange={(next) => setView(next as ContractChangesView)}
          items={items}
        />
      </div>

      <div className="p-4 sm:p-5">
        {view === 'variations' ? <VariationsTab projectId={projectId} summary={summary} /> : null}
        {view === 'eot' ? (
          <ExtensionOfTimeSection contractId={contractId} projectId={projectId} variations={variations} />
        ) : null}
        {view === 'separate' ? (
          <SeparateChargesSection projectId={projectId} />
        ) : null}
      </div>
      <p className="border-t border-border px-5 py-3 text-caption text-muted-foreground">
        {t.rich('note', {
          boq: (chunks) => (
            <Link href={`/projects/${projectId}/boq`} className="font-medium text-brand-primary hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </section>
  );
}

// ─── Separate Charges Section (Slice D) ──────────────────────────────────────

function SeparateChargesSection({ projectId }: { projectId: string }) {
  const t = useTranslations('commercial.contractMilestones.separateCharges');
  const locale = useLocale() as 'en' | 'ar';
  const query = useProjectSeparateCharges(projectId);
  // Invoicing a separate charge is the billing permission; everyone else sees the row, no command.
  const canBill = useCommercialWorkspace(projectId).data?.capabilities.canBill ?? false;
  const [creatingFor, setCreatingFor] = useState<Extract<
    SeparateChargeNode,
    { source: 'BOQ_LEAF' }
  > | null>(null);

  if (query.isPending) {
    return <Skeleton className="h-24 w-full rounded-panel" />;
  }

  if (query.isError || !query.data) return null;

  const { items } = query.data;

  // No own border/title here — this only ever renders as a tab body inside ContractChangesPanel,
  // whose outer panel supplies the border and whose tab label already reads "Separate charges
  // (N)". A second nested box repeating both was the exact box-in-a-box look this panel exists
  // to avoid.
  return (
    <div>
      {items.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-body-sm font-medium text-foreground">{t('emptyTitle')}</p>
          <p className="mt-1 text-caption text-muted-foreground">{t('emptyHint')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-panel border border-border">
          {items.map((item) => (
            <SeparateChargeRow
              key={item.id}
              item={item}
              locale={locale}
              t={t}
              onCreateInvoice={
                canBill && item.source === 'BOQ_LEAF' ? () => setCreatingFor(item) : undefined
              }
            />
          ))}
        </ul>
      )}

      {creatingFor && (
        <CreateSeparateChargeInvoiceDialog
          projectId={projectId}
          node={creatingFor}
          onClose={() => setCreatingFor(null)}
        />
      )}
    </div>
  );
}

function SeparateChargeRow({
  item,
  locale,
  onCreateInvoice,
  t,
}: {
  item: SeparateChargeNode;
  locale: string;
  /** Absent when the viewer cannot bill: the row shows its state and no command. */
  onCreateInvoice?: () => void;
  t: (key: string) => string;
}) {
  const fmtMoney = (v: string | null) =>
    v ? (formatMoney(v, item.currency, locale as 'en' | 'ar') ?? v) : '—';
  // A VO addition billed standalone (source: VARIATION) is created with its invoice atomically
  // (issuePackage → generateStandaloneCharge) — there is no un-invoiced state to offer "Create
  // invoice" for, unlike a BOQ_LEAF item, which can sit un-invoiced until billed on demand.
  const reference = item.source === 'BOQ_LEAF' ? item.code : item.variationReference;

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-foreground">{item.name}</p>
        <p className="mt-0.5 text-caption text-muted-foreground">
          <span className="font-mono">{reference}</span>
          {item.totalAmount ? ` · ${fmtMoney(item.totalAmount)}` : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.invoice ? (
          <Badge tone="success" className="text-caption">{t('statusInvoiced')}</Badge>
        ) : (
          <>
            <Badge tone="neutral" className="text-caption">{t('statusNotBilled')}</Badge>
            {onCreateInvoice ? (
              <Button type="button" variant="outline" size="sm" onClick={onCreateInvoice}>
                {t('createInvoice')}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

/** Invoice one separate charge — a `FormDialog` (ADR-039), size `md`: three fields. */
function CreateSeparateChargeInvoiceDialog({
  projectId,
  node,
  onClose,
}: {
  projectId: string;
  // Only a BOQ_LEAF item can be un-invoiced — the row only offers this action when `invoice` is
  // null, which a VARIATION item's invoice (created atomically with its allocation) never is.
  node: Extract<SeparateChargeNode, { source: 'BOQ_LEAF' }>;
  onClose: () => void;
}) {
  const t = useTranslations('commercial.contractMilestones.separateCharges.dialog');
  const today = new Date().toISOString().slice(0, 10);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const mutation = useCreateSeparateChargeInvoice(projectId);

  async function handleSubmit() {
    if (!dueDate) return;
    await mutation.mutateAsync({
      boqNodeId: node.id,
      invoiceDate,
      dueDate,
      paymentTerms: paymentTerms || undefined,
    });
    onClose();
  }

  const dirty = invoiceDate !== today || dueDate !== '' || paymentTerms !== '';

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('title')}
      subtitle={t('description')}
      size="md"
      dirty={dirty}
      busy={mutation.isPending}
    >
      <FormDialogBody>
        {mutation.error && (
          <Alert variant="error" messages={[(mutation.error as Error).message]} />
        )}
        <FormField htmlFor="sc-invoice-date" label={t('invoiceDate')}>
          <DatePicker
            id="sc-invoice-date"
            value={invoiceDate}
            onChange={setInvoiceDate}
            disabled={mutation.isPending}
          />
        </FormField>
        <FormField htmlFor="sc-due-date" label={t('dueDate')}>
          <DatePicker
            id="sc-due-date"
            value={dueDate}
            onChange={setDueDate}
            disabled={mutation.isPending}
          />
        </FormField>
        <FormField htmlFor="sc-payment-terms" label={t('paymentTerms')}>
          <Input
            id="sc-payment-terms"
            type="text"
            placeholder={t('paymentTermsPlaceholder')}
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            disabled={mutation.isPending}
          />
        </FormField>
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={mutation.isPending}>
            {t('cancel')}
          </Button>
        </FormDialogClose>
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!dueDate || mutation.isPending}
        >
          {mutation.isPending ? t('submitting') : t('submit')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
