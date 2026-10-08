'use client';

/**
 * The payment section's dialogs in one place, so the section and the record-receipt screen open
 * the same prefilled dialogs (ADR-045 wireframes B and F; top-up S7; change returned S6).
 */

import type { QuotationPayment } from '../../quotations/payment-types';
import type { QuotationRequestDetail } from '../../quotations/types';
import { ChangeReturnedDialog } from './change-returned-dialog';
import { PaySupplierDialog } from './pay-supplier-dialog';
import { ReleaseCashDialog } from './release-cash-dialog';

export type PaymentDialog = 'release' | 'topUp' | 'pay' | 'path' | 'return' | null;

export function PayDialogs({
  open,
  detail,
  payment,
  storeName,
  topUpBillId,
  onClose,
  onGated,
  onAwaitingSignatures,
}: {
  open: PaymentDialog;
  detail: QuotationRequestDetail;
  payment: QuotationPayment;
  storeName: string;
  topUpBillId: string | null;
  onClose: () => void;
  onGated: (approvalInstanceId: string | null, kind: 'release' | 'pay') => void;
  onAwaitingSignatures: () => void;
}) {
  if (open === 'release' || open === 'topUp') {
    return (
      <ReleaseCashDialog
        requestId={detail.id}
        storeName={storeName}
        mode={open === 'topUp' ? 'topUp' : 'release'}
        applyToBillId={open === 'topUp' ? topUpBillId : null}
        onClose={onClose}
        onGated={(instance) => onGated(instance, 'release')}
      />
    );
  }
  if (open === 'pay') {
    return (
      <PaySupplierDialog
        requestId={detail.id}
        storeName={storeName}
        currencyCode={detail.currencyCode ?? 'USD'}
        onClose={onClose}
        onAwaiting={(awaiting, instance) => {
          if (awaiting === 'APPROVAL') onGated(instance, 'pay');
          else onAwaitingSignatures();
        }}
      />
    );
  }
  if (open === 'return') {
    return (
      <ChangeReturnedDialog
        requestId={detail.id}
        payment={payment}
        currencyCode={detail.currencyCode ?? 'USD'}
        onClose={onClose}
      />
    );
  }
  return null;
}
