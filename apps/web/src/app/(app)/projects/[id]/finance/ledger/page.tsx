import { redirect } from 'next/navigation';

import { financeProjectRedirects } from '@/features/finance-projects/redirects';

/** ADR-043 Phase 3 — the project ledger now sits under Finance → Projects → P&L. */
export default async function LegacyLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(financeProjectRedirects.ledger(id));
}
