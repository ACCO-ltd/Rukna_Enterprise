import { redirect } from 'next/navigation';

import { financeProjectRedirects } from '@/features/finance-projects/redirects';

/**
 * ADR-043 Phase 3 — billing and collection (prepare / issue invoices, send, record payments,
 * reminders) moved to Finance → Projects → Billing (decision 1: Finance issues invoices). The
 * project's Commercial tab keeps the contract, the schedule and a money-free status per stage.
 */
export default async function CommercialBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(financeProjectRedirects.billing(id));
}
