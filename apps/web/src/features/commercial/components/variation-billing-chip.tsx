'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@erp/ui';
import type {
  CommercialBillingPackageInvoice,
  VariationAllocationTreatment,
} from '@erp/types';

/** One VO's single billing allocation, projected from the Billing Packages read (S-VB-12). */
export interface VariationBilling {
  treatment: `${VariationAllocationTreatment}`;
  invoice: CommercialBillingPackageInvoice | null;
}

export type VariationBillingLookup = Map<string, VariationBilling>;

/**
 * The "invoiced?" chip (S-VB-12).
 *
 * A VO that carries a billing allocation reports how it was realized; a client-approved VO with no
 * allocation yet reads "Approved · not billed"; anything not yet approved shows nothing (an em
 * dash), because "not billed" is only meaningful once the client has agreed to the change. The chip
 * never fabricates an invoice link — the number as text is the whole message.
 *
 * Takes only the VO's `status`, so both the list row (`VariationOrderListItem`) and the detail
 * drawer (`VariationOrderResponse`) can render the same chip from one source of truth.
 */
export function VariationBillingChip({
  status,
  billing,
}: {
  status: string;
  billing: VariationBilling | null;
}) {
  const t = useTranslations('commercial.variations.billing');

  if (billing) {
    if (billing.treatment === 'STAGE_REDUCTION') {
      return <Badge tone="neutral">{t('omissionBilled')}</Badge>;
    }
    if (billing.treatment === 'INVOICE') {
      return billing.invoice?.invoiceNumber ? (
        <Badge tone="live">{t('invoiced', { number: billing.invoice.invoiceNumber })}</Badge>
      ) : (
        <Badge tone="neutral">{t('invoicedDraft')}</Badge>
      );
    }
    // CREDIT_NOTE (declared for Phase 2, not produced in P1) falls through to the neutral posture.
    return <Badge tone="neutral">{t('invoicedDraft')}</Badge>;
  }

  if (status === 'CLIENT_APPROVED') {
    return <Badge tone="warning">{t('approvedNotBilled')}</Badge>;
  }

  return <span className="text-caption text-muted-foreground">—</span>;
}
