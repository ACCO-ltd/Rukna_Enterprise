import { redirect } from 'next/navigation';

import { financeProjectRedirects } from '@/features/finance-projects/redirects';

/** ADR-043 Phase 3 — a bill opened from the old project ledger opens on the accounting bill page. */
export default async function LegacyProjectBillRoute({
  params,
}: {
  params: Promise<{ id: string; billId: string }>;
}) {
  const { billId } = await params;
  redirect(financeProjectRedirects.bill(billId));
}
