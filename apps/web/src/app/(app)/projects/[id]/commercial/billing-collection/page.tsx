import { redirect } from 'next/navigation';

import { financeProjectRedirects } from '@/features/finance-projects/redirects';

/** Older name of the billing view — straight to Finance → Projects → Billing (ADR-043 Phase 3). */
export default async function BillingCollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(financeProjectRedirects.billing(id));
}
