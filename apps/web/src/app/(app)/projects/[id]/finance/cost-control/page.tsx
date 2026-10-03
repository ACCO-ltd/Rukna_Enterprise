import { redirect } from 'next/navigation';

import { financeProjectRedirects } from '@/features/finance-projects/redirects';

/** ADR-043 Phase 3 — moved to Finance → Projects → Cost & commitments. */
export default async function LegacyCostControlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(financeProjectRedirects.costControl(id));
}
