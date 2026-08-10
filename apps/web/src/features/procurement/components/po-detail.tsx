'use client';

/**
 * Purchase order detail (§12.6).
 *
 * Revisions are tabs. The ACTIVE one is preselected; superseded ones stay reachable
 * because the commitment ledger references them by revision and a reader tracing a
 * committed figure needs to see the lines it came from.
 *
 * Two pieces of copy deliberately depart from §12.6, because §12.6 describes behaviour
 * the server does not have:
 *
 *  - The approve drawer does **not** say the superseded revision's "uncommitted balance
 *    will be reversed". It reverses the full original value, so if goods were already
 *    received against it, COMMITTED is reduced twice and goes negative (P11).
 *  - The cancel dialog says the order's commitment entries will remain, because `cancel`
 *    writes no reversal at all and no endpoint can correct it afterwards (P12).
 *
 * Saying the reassuring thing would be easy and wrong. These figures are what a project
 * manager reads to decide whether there is budget left.
 */

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormField,
  Input,
  Sheet,
  SheetContent,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits } from '@/lib/money';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import {
  useApprovePurchaseOrder,
  useCancelPurchaseOrder,
  usePurchaseOrder,
  useSubmitPurchaseOrder,
} from '../hooks/use-procurement';
import { activeRevision, revisionTotalMinor } from '../quantities';
import type { PurchaseOrder, PurchaseOrderRevision } from '../types';
import { ProcurementStatusBadge } from './procurement-badges';

export function PoDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const po = usePurchaseOrder(id);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const submit = useSubmitPurchaseOrder();
  const cancel = useCancelPurchaseOrder();

  if (po.isPending) {
    return (
      <div role="status" aria-live="polite">
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (po.isError || !po.data) {
    return <Alert variant="error" messages={[tc('loadFailed')]} />;
  }

  const order: PurchaseOrder = po.data;
  const active = activeRevision(order.revisions);
  const draft = order.revisions.find((r) => r.status === 'DRAFT');
  const submitted = order.revisions.find((r) => r.status === 'SUBMITTED');
  const defaultTab = String((active ?? draft ?? order.revisions[0])?.revisionNumber ?? 1);

  const isOpen = order.status === 'OPEN';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t('detailTitle', { number: order.poNumber })}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ProcurementStatusBadge status={order.status} />
            <span className="text-sm text-muted-foreground">
              {order.supplier?.name ?? tc('notAvailable')}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {isOpen && draft ? (
            <Button
              type="button"
              onClick={() => submit.mutate(order.id)}
              disabled={submit.isPending}
            >
              {t('submit')}
            </Button>
          ) : null}

          {isOpen && submitted && can(PROCUREMENT_PERMISSIONS.approveOrder) ? (
            <Button type="button" onClick={() => setApproving(true)}>
              {t('approve')}
            </Button>
          ) : null}

          {isOpen ? (
            <Button type="button" variant="destructive" onClick={() => setCancelling(true)}>
              {t('cancelOrder')}
            </Button>
          ) : null}
        </div>
      </div>

      {order.revisions.length === 0 ? (
        <Alert variant="info" messages={[tc('noResults')]} />
      ) : (
        <Tabs defaultValue={defaultTab}>
          <TabsList>
            {order.revisions.map((revision) => (
              <TabsTrigger key={revision.id} value={String(revision.revisionNumber)}>
                {t('revisionTab', { number: revision.revisionNumber })}
              </TabsTrigger>
            ))}
          </TabsList>

          {order.revisions.map((revision) => (
            <TabsContent key={revision.id} value={String(revision.revisionNumber)}>
              <RevisionPanel
                revision={revision}
                total={t('revisionOf', {
                  number: revision.revisionNumber,
                  total: order.revisions.length,
                })}
                locale={locale}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}

      {approving && submitted ? (
        <ApproveDrawer
          revision={submitted}
          hasSupersededTarget={Boolean(active)}
          onClose={() => setApproving(false)}
          orderId={order.id}
          locale={locale}
        />
      ) : null}

      {cancelling ? (
        <ConfirmActionDialog
          title={t('cancelTitle', { number: order.poNumber })}
          description={`${t('cancelBody')} ${t('cancelCommitmentWarning')}`}
          confirmLabel={t('cancelOrder')}
          isPending={cancel.isPending}
          errorMessage={cancel.isError ? tc('loadFailed') : undefined}
          onConfirm={() =>
            cancel.mutate(order.id, { onSuccess: () => setCancelling(false) })
          }
          onDismiss={() => setCancelling(false)}
        />
      ) : null}
    </div>
  );
}

function RevisionPanel({
  revision,
  total,
  locale,
}: {
  revision: PurchaseOrderRevision;
  total: string;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const tType = useTranslations('procurement.lineType');

  const lines = revision.lines ?? [];
  const totalMinor = revisionTotalMinor(lines);

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <ProcurementStatusBadge status={revision.status} />
        <span className="text-xs text-muted-foreground">{total}</span>
      </div>

      <dl className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={tc('currency')} value={revision.currencyCode} />
        <Field
          label={t('effectiveFrom')}
          value={formatDate(revision.effectiveFrom, locale) ?? tc('notAvailable')}
        />
        <Field
          label={t('expectedDelivery')}
          value={formatDate(revision.expectedDeliveryDate, locale) ?? tc('notAvailable')}
        />
        <Field label={t('deliveryAddress')} value={revision.deliveryAddress ?? tc('notAvailable')} />
        {revision.reason ? <Field label={t('reason')} value={revision.reason} /> : null}
        {revision.approvedAt ? (
          <Field
            label={t('approve')}
            value={formatDate(revision.approvedAt, locale) ?? tc('notAvailable')}
          />
        ) : null}
      </dl>

      <TableScroll aria-label={t('detailTitle', { number: revision.revisionNumber })}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-end">{tc('lineNumber')}</TableHead>
              <TableHead>{tc('type')}</TableHead>
              <TableHead>{tc('description')}</TableHead>
              <TableHead>{tc('uom')}</TableHead>
              <TableHead className="text-end">{t('orderedQuantity')}</TableHead>
              <TableHead className="text-end">{tc('unitPrice')}</TableHead>
              <TableHead className="text-end">{t('extendedAmount')}</TableHead>
              <TableHead>{tc('spendCategory')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="text-end tabular-nums">{line.lineNumber}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {tType(line.lineType)}
                </TableCell>
                <TableCell className="text-sm">
                  {line.material ? (
                    <span className="me-2 font-mono text-xs text-muted-foreground">
                      {line.material.code}
                    </span>
                  ) : null}
                  {line.description}
                </TableCell>
                <TableCell>
                  <bdi className="text-sm">{line.uom?.symbol ?? line.uom?.code ?? '—'}</bdi>
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatNumber(line.orderedQuantity, locale)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatMoney(line.unitPrice, revision.currencyCode, locale)}
                </TableCell>
                <TableCell className="text-end font-medium tabular-nums">
                  {formatMoney(line.extendedAmount, revision.currencyCode, locale)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {line.spendCategory?.name ?? tc('notAvailable')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>

      <p className="text-end text-sm">
        <span className="text-muted-foreground">{tc('total')}: </span>
        <span className="font-semibold tabular-nums">
          {formatMoney(fromMinorUnits(totalMinor, MONEY_SCALE), revision.currencyCode, locale)}
        </span>
      </p>
    </div>
  );
}

/**
 * Approval drawer.
 *
 * Shows what approving will commit, and — when a revision is being superseded — what the
 * reversal actually does, which is not what §12.6 says it does (P11).
 */
function ApproveDrawer({
  revision,
  hasSupersededTarget,
  orderId,
  onClose,
  locale,
}: {
  revision: PurchaseOrderRevision;
  hasSupersededTarget: boolean;
  orderId: string;
  onClose: () => void;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const approve = useApprovePurchaseOrder();

  const [reportingCurrencyCode, setReportingCurrencyCode] = useState(revision.currencyCode);
  const [exchangeRate, setExchangeRate] = useState('1');

  const totalMinor = revisionTotalMinor(revision.lines ?? []);
  const amount =
    formatMoney(fromMinorUnits(totalMinor, MONEY_SCALE), revision.currencyCode, locale) ?? '';

  const rate = Number(exchangeRate);
  const rateValid = Number.isFinite(rate) && rate > 0;

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent className="p-6">
        <SheetTitle className="text-lg font-semibold text-foreground">
          {t('approveTitle', { number: revision.revisionNumber })}
        </SheetTitle>

        <div className="mt-5 space-y-4">
          <Alert variant="info" messages={[t('approveCommitmentNotice', { amount })]} />

          {hasSupersededTarget ? (
            <Alert
              variant="warning"
              messages={[t('approveSupersedeNotice'), t('approveSupersedeWarning')]}
            />
          ) : null}

          <FormField htmlFor="approve-reporting-currency" label={t('reportingCurrency')}>
            <Input
              id="approve-reporting-currency"
              value={reportingCurrencyCode}
              onChange={(e) => setReportingCurrencyCode(e.target.value.toUpperCase())}
              maxLength={3}
            />
          </FormField>

          <FormField
            htmlFor="approve-exchange-rate"
            label={t('exchangeRate')}
            error={rateValid ? undefined : tc('required')}
          >
            <Input
              id="approve-exchange-rate"
              inputMode="decimal"
              value={exchangeRate}
              onChange={(e) => setExchangeRate(e.target.value)}
              className="text-end tabular-nums"
            />
          </FormField>

          {approve.isError ? <Alert variant="error" messages={[tc('loadFailed')]} /> : null}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={approve.isPending}
            >
              {tc('cancel')}
            </Button>
            <Button
              type="button"
              disabled={approve.isPending || !rateValid}
              onClick={() =>
                approve.mutate(
                  { id: orderId, payload: { reportingCurrencyCode, exchangeRate: rate } },
                  { onSuccess: onClose },
                )
              }
            >
              {t('approve')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}
