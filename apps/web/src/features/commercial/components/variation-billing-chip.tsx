'use client';

import { useTranslations } from 'next-intl';
import { StatusText } from '@erp/ui';
import type {
  CommercialBillingPackageInvoice,
  VariationAllocationTreatment,
} from '@erp/types';

import { statusTone } from '@/lib/status-registry';

/** One VO's single billing allocation, projected from the Billing Packages read (S-VB-12). */
export interface VariationBilling {
  treatment: `${VariationAllocationTreatment}`;
  invoice: CommercialBillingPackageInvoice | null;
}

export type VariationBillingLookup = Map<string, VariationBilling>;

/** How far an approved VO has been realised in billing — keys of the `variationBilling` vocabulary. */
export type VariationBillingState =
  | 'APPROVED_NOT_BILLED'
  | 'INVOICE_DRAFT'
  | 'INVOICED'
  | 'OMISSION_BILLED';

/**
 * The "invoiced?" chip (S-VB-12).
 *
 * A VO that carries a billing allocation reports how it was realized; a client-approved VO with no
 * allocation yet reads "Approved · not billed"; anything not yet approved shows nothing (an em
 * dash), because "not billed" is only meaningful once the client has agreed to the change. The chip
 * never fabricates an invoice link — the number as text is the whole message.
 *
 * Billing is a second axis beside the VO's status pill, so it renders as quiet dot + text; the tone
 * comes from the status registry (ADR-034). Takes only the VO's `status`, so both the list row
 * (`VariationOrderListItem`) and the detail dialog (`VariationOrderResponse`) can render the same
 * chip from one source of truth.
 */
export function VariationBillingChip({
  status,
  billing,
}: {
  status: string;
  billing: VariationBilling | null;
}) {
  const t = useTranslations('commercial.variations.billing');

  const chip = (state: VariationBillingState, label: string) => (
    <StatusText tone={statusTone(state, 'variationBilling')}>{label}</StatusText>
  );

  if (billing) {
    if (billing.treatment === 'STAGE_REDUCTION') {
      return chip('OMISSION_BILLED', t('omissionBilled'));
    }
    if (billing.treatment === 'INVOICE' && billing.invoice?.invoiceNumber) {
      return chip('INVOICED', t('invoiced', { number: billing.invoice.invoiceNumber }));
    }
    // An INVOICE allocation whose invoice has no number yet, and CREDIT_NOTE (declared for
    // Phase 2, not produced in P1), both read as a draft.
    return chip('INVOICE_DRAFT', t('invoicedDraft'));
  }

  if (status === 'CLIENT_APPROVED') {
    return chip('APPROVED_NOT_BILLED', t('approvedNotBilled'));
  }

  return <span className="text-caption text-muted-foreground">—</span>;
}
