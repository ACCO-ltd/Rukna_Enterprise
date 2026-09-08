'use client';

import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  LtrValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  ViewSwitcher,
} from '@erp/ui';
import type { ProjectRequirementDetail } from '@erp/types';

import { formatDate, formatMoney } from '@/lib/format';

import { useProjectRequirement } from '../../hooks/use-project-procurement';
import { APPROVAL_TONE, FULFILMENT_TONE, PRIORITY_TONE } from './requirement-tones';

type DetailTab = 'details' | 'items' | 'pos';

/**
 * One requirement, in depth.
 *
 * Three tabs, not four. **History is deliberately absent**: the audit log has no
 * resource-scoped endpoint, and a tab that renders an empty feed advertises a capability the
 * platform does not have. It comes back when there is something real behind it.
 *
 * Attachments are absent for the same reason — no attachment model, and file serving is deferred
 * platform-wide.
 */
export function RequirementDetailDialog({
  projectId,
  requirementId,
  onClose,
}: {
  projectId: string;
  requirementId: string;
  onClose: () => void;
}) {
  const t = useTranslations('procurement.project.requirements');
  const [tab, setTab] = React.useState<DetailTab>('details');
  const query = useProjectRequirement(projectId, requirementId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {query.isPending ? (
          <>
            <DialogTitle>{t('detailLoading')}</DialogTitle>
            <Skeleton className="mt-4 h-64 w-full" />
          </>
        ) : query.isError || !query.data ? (
          <>
            <DialogTitle>{t('detailFailed')}</DialogTitle>
            <p className="mt-2 text-body-sm text-muted-foreground">{t('detailFailedHint')}</p>
          </>
        ) : (
          <DetailBody data={query.data} tab={tab} onTab={setTab} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({
  data,
  tab,
  onTab,
}: {
  data: ProjectRequirementDetail;
  tab: DetailTab;
  onTab: (t: DetailTab) => void;
}) {
  const t = useTranslations('procurement.project.requirements');

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <DialogTitle className="text-h2 font-bold">
            {data.title ?? data.description ?? t('untitled')}
          </DialogTitle>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
            <LtrValue className="font-mono">{data.mrNumber}</LtrValue>
            <Badge tone={APPROVAL_TONE[data.approvalStatus]}>
              {t(`approval.${data.approvalStatus}`)}
            </Badge>
            <Badge tone={FULFILMENT_TONE[data.fulfillmentStatus]}>
              {t(`fulfilment.${data.fulfillmentStatus}`)}
            </Badge>
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-0">
          <Link href={`/procurement/requests/${data.id}`}>
            {t('openInProcurement')}
            <ExternalLink size={13} aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <div className="mt-4">
        <ViewSwitcher
          aria-label={t('detailTabsLabel')}
          value={tab}
          onValueChange={(next) => onTab(next as DetailTab)}
          items={[
            { value: 'details', label: t('tab.details') },
            { value: 'items', label: t('tab.items', { n: data.lines.length }) },
            { value: 'pos', label: t('tab.pos', { n: data.purchaseOrders.length }) },
          ]}
        />
      </div>

      <div className="mt-4 max-h-[60vh] overflow-y-auto">
        {tab === 'details' ? <DetailsTab data={data} /> : null}
        {tab === 'items' ? <ItemsTab data={data} /> : null}
        {tab === 'pos' ? <PurchaseOrdersTab data={data} /> : null}
      </div>
    </div>
  );
}

// ─── Details ────────────────────────────────────────────────────────────────────

function DetailsTab({ data }: { data: ProjectRequirementDetail }) {
  const t = useTranslations('procurement.project.requirements');
  const locale = useLocale() as 'en' | 'ar';
  const money = (v: string | null) =>
    v === null ? t('restricted') : (formatMoney(v, data.currencyCode, locale) ?? '—');

  return (
    <div className="space-y-4">
      <dl className="grid gap-x-6 sm:grid-cols-2">
        <Fact label={t('field.mrNumber')} value={data.mrNumber} mono />
        <Fact label={t('col.priority')} value={t(`priority.${data.priority}`)} />
        <Fact label={t('col.category')} value={data.category ?? '—'} />
        <Fact
          label={t('field.requiredAtSite')}
          value={formatDate(data.requiredByDate, locale) ?? t('field.noRequiredDate')}
        />
        <Fact label={t('field.requestedOn')} value={formatDate(data.requestedDate, locale) ?? '—'} />
        <Fact label={t('field.createdOn')} value={formatDate(data.createdAt, locale) ?? '—'} />
      </dl>

      {data.description ? (
        <div>
          <p className="text-caption font-medium text-muted-foreground">
            {t('field.description')}
          </p>
          <p className="mt-1 text-body-sm text-foreground">{data.description}</p>
        </div>
      ) : null}

      <dl className="grid gap-x-6 rounded-panel border border-border bg-surface-subtle p-4 sm:grid-cols-3">
        <Fact label={t('col.estimated')} value={money(data.estimatedValue)} />
        <Fact label={t('col.ordered')} value={money(data.orderedValue)} />
        <Fact label={t('field.remaining')} value={money(data.remainingValue)} />
      </dl>
      {/* Two different bases. The gap between them is not a saving — a buyer beating an estimate
          and a buyer part-ordering look identical in one number. */}
      <p className="text-caption text-muted-foreground">{t('valueBasisNote')}</p>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-b border-border/70 py-2 last:border-b-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-body-sm font-medium text-foreground ${mono ? 'font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

// ─── Items ──────────────────────────────────────────────────────────────────────

/**
 * The lines, where the requirement's value and its cost coding actually live.
 *
 * Each line names its own cost target — a BOQ node for measured scope, a spend category for
 * project-level cost. The header carries neither, and this never invents one.
 */
function ItemsTab({ data }: { data: ProjectRequirementDetail }) {
  const t = useTranslations('procurement.project.requirements');
  const locale = useLocale() as 'en' | 'ar';

  if (data.lines.length === 0) {
    return <p className="text-body-sm text-muted-foreground">{t('noItems')}</p>;
  }

  return (
    <TableScroll>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col.description')}</TableHead>
            <TableHead className="text-end">{t('col.qty')}</TableHead>
            <TableHead className="text-end">{t('col.estUnitPrice')}</TableHead>
            <TableHead className="text-end">{t('col.estimated')}</TableHead>
            <TableHead>{t('col.costTarget')}</TableHead>
            <TableHead className="text-end">{t('col.orderedQty')}</TableHead>
            <TableHead>{t('col.fulfilment')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell className="font-medium text-foreground">{line.description}</TableCell>
              <TableCell className="whitespace-nowrap text-end tabular-nums">
                {trimQty(line.quantity)} {line.uomCode ?? ''}
              </TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground">
                {line.estimatedUnitPrice === null
                  ? '—'
                  : (formatMoney(line.estimatedUnitPrice, data.currencyCode, locale) ?? '—')}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {line.estimatedValue === null
                  ? '—'
                  : (formatMoney(line.estimatedValue, data.currencyCode, locale) ?? '—')}
              </TableCell>
              <TableCell className="text-caption text-muted-foreground">
                {line.costTargetLabel ?? t(`costTarget.${line.costTargetKind}`)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-end tabular-nums text-muted-foreground">
                {trimQty(line.orderedQuantity)}
              </TableCell>
              <TableCell>
                <Badge tone={FULFILMENT_TONE[line.fulfillmentStatus]}>
                  {t(`fulfilment.${line.fulfillmentStatus}`)}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroll>
  );
}

/** `500.0000` → `500`. Four stored decimals are precision, not something to read. */
function trimQty(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

// ─── Purchase orders ────────────────────────────────────────────────────────────

/**
 * The purchase orders this requirement reached.
 *
 * **Document state and revision lifecycle are separate columns and stay separate.**
 * `PurchaseOrder.status` is only OPEN/CLOSED/CANCELLED; DRAFT→SUBMITTED→APPROVED→ACTIVE belongs
 * to an immutable revision. "PO-0021 Approved" as one status would conflate two records, which is
 * the same class of error as merging a requirement's approval and fulfilment.
 *
 * The project traces these documents; it does not operate them. Every row links out.
 */
function PurchaseOrdersTab({ data }: { data: ProjectRequirementDetail }) {
  const t = useTranslations('procurement.project.requirements');
  const locale = useLocale() as 'en' | 'ar';

  if (data.purchaseOrders.length === 0) {
    return <p className="text-body-sm text-muted-foreground">{t('noPurchaseOrders')}</p>;
  }

  return (
    <TableScroll>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col.po')}</TableHead>
            <TableHead>{t('col.revision')}</TableHead>
            <TableHead>{t('col.poState')}</TableHead>
            <TableHead>{t('col.supplier')}</TableHead>
            <TableHead className="text-end">{t('col.ordered')}</TableHead>
            <TableHead className="text-end">{t('col.action')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.purchaseOrders.map((po) => (
            <TableRow key={po.id}>
              <TableCell className="whitespace-nowrap font-mono text-caption text-foreground">
                {po.poNumber}
              </TableCell>
              <TableCell className="whitespace-nowrap text-caption text-muted-foreground">
                {po.revisionNumber === null
                  ? '—'
                  : `${t('revShort', { n: po.revisionNumber })} · ${t(`revisionStatus.${po.revisionStatus}`)}`}
              </TableCell>
              <TableCell>
                <Badge tone={po.documentState === 'OPEN' ? 'live' : 'historical'}>
                  {t(`poState.${po.documentState}`)}
                </Badge>
              </TableCell>
              <TableCell className="text-body-sm text-foreground">
                {po.supplierName ?? '—'}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {po.orderedValue === null
                  ? '—'
                  : (formatMoney(po.orderedValue, data.currencyCode, locale) ?? '—')}
              </TableCell>
              <TableCell className="text-end">
                <Button asChild variant="ghost" size="sm" className="min-h-11 sm:min-h-0">
                  <Link href={`/procurement/orders/${po.id}`}>
                    {t('open')}
                    <ExternalLink size={13} aria-hidden="true" />
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroll>
  );
}
