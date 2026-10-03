import { redirect } from 'next/navigation';

import { financeProjectRedirects } from '@/features/finance-projects/redirects';

/**
 * The oldest project P&L URL. It first moved under the project Finance tab; since ADR-043 Phase 3
 * the P&L lives in Finance → Projects, so it goes straight there (one hop, not two).
 */
export default async function LegacyProjectPlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(financeProjectRedirects.profitLoss(id));
}
