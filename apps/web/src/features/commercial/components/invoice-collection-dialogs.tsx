'use client';

import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@erp/ui';
import type { CommercialInvoiceRow, CommercialReceiptRow } from '@erp/types';

import { useCommercialBilling } from '../hooks/use-commercial';
import {
  buildInvoiceTimeline,
  type CollectionEvent,
  type DisputeReason,
  type FollowUpMethod,
  type TimelinePaymentEntry,
} from '../lib/collection-events';
import { toClientReceivableView } from '../lib/collection-view-model';
import { InvoiceTimelineDialog } from './invoice-timeline';
import { OpenDisputeDialog } from './open-dispute-dialog';
import { RecordFollowUpDialog } from './record-followup-dialog';
import { RecordPromiseDialog } from './record-promise-dialog';

export type CollectionDialogKind = 'followup' | 'promise' | 'dispute' | 'history';

/**
 * The collection tools for one issued invoice — Log follow-up, Record promise to pay, Open
 * dispute, History — reusing the existing dialogs as they are. They take the billing read model's
 * row for the invoice (events, receipts), so this loads `GET …/commercial/billing` and picks the
 * invoice out of it.
 */
export function InvoiceCollectionDialogs({
  kind,
  projectId,
  invoiceId,
  onClose,
}: {
  kind: CollectionDialogKind;
  projectId: string;
  invoiceId: string;
  onClose: () => void;
}) {
  const t = useTranslations('commercial.invoicePage.collection');
  const billing = useCommercialBilling(projectId);
  const onOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  if (billing.isPending) {
    return (
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
    );
  }

  const row = billing.data?.invoices.find((invoice) => invoice.id === invoiceId);
  if (billing.isError || !row) {
    return (
      <InfoDialog
        title={t(`title.${kind}`)}
        body={billing.isError ? billing.error.message || t('loadFailed') : t('notFound')}
        error
        closeLabel={t('close')}
        onClose={onClose}
      />
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const invoice = toClientReceivableView(row, today);
  const currency = billing.data.currency ?? row.currency;

  if (kind === 'followup') {
    return <RecordFollowUpDialog open onOpenChange={onOpenChange} invoice={invoice} projectId={projectId} />;
  }
  if (kind === 'promise') {
    return <RecordPromiseDialog open onOpenChange={onOpenChange} invoice={invoice} projectId={projectId} />;
  }
  if (kind === 'dispute') {
    if (row.openDispute && !row.openDispute.resolvedAt) {
      return (
        <InfoDialog
          title={t('disputeOpenTitle')}
          body={t('disputeOpenBody')}
          closeLabel={t('close')}
          onClose={onClose}
        />
      );
    }
    return (
      <OpenDisputeDialog
        open
        onOpenChange={onOpenChange}
        invoice={invoice}
        currency={currency}
        projectId={projectId}
      />
    );
  }

  return (
    <InvoiceTimelineDialog
      open
      onOpenChange={onOpenChange}
      invoice={invoice}
      currency={currency}
      entries={buildInvoiceTimeline({
        issuedAt: invoice.issuedAt,
        sentAt: invoice.sentAt,
        events: collectionEvents(row),
        payments: paymentsFor(invoiceId, billing.data.receipts),
        today,
      })}
    />
  );
}

/** The server's Slice 6B collection DTOs, as the `CollectionEvent` union the timeline reads. */
function collectionEvents(row: CommercialInvoiceRow): CollectionEvent[] {
  const events: CollectionEvent[] = [];
  for (const followUp of row.followUps ?? []) {
    events.push({
      kind: 'FOLLOW_UP',
      id: followUp.id,
      invoiceId: row.id,
      method: followUp.method as FollowUpMethod,
      contactPerson: followUp.contactPerson,
      note: followUp.note,
      recordedAt: followUp.recordedAt,
    });
  }
  for (const promise of row.promises ?? []) {
    events.push({
      kind: 'PROMISE',
      id: promise.id,
      invoiceId: row.id,
      promisedDate: promise.promisedDate,
      promisedAmount: promise.promisedAmount,
      note: promise.note,
      recordedAt: promise.recordedAt,
    });
  }
  if (row.openDispute) {
    events.push({
      kind: 'DISPUTE',
      id: row.openDispute.id,
      invoiceId: row.id,
      disputedAmount: row.openDispute.disputedAmount,
      reason: row.openDispute.reason as DisputeReason,
      note: row.openDispute.note,
      openedAt: row.openDispute.openedAt,
      resolvedAt: row.openDispute.resolvedAt,
    });
  }
  return events;
}

function paymentsFor(invoiceId: string, receipts: CommercialReceiptRow[]): TimelinePaymentEntry[] {
  return receipts.flatMap((receipt) =>
    receipt.allocations
      .filter((allocation) => allocation.invoiceId === invoiceId)
      .map((allocation) => ({
        date: receipt.receiptDate,
        amount: allocation.allocatedAmount,
        method: receipt.paymentMethod,
      })),
  );
}

function InfoDialog({
  title,
  body,
  error = false,
  closeLabel,
  onClose,
}: {
  title: string;
  body: string;
  error?: boolean;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {error ? null : <DialogDescription>{body}</DialogDescription>}
        </DialogHeader>
        {error ? (
          <div className="mt-4">
            <Alert variant="error" messages={[body]} />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {closeLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
