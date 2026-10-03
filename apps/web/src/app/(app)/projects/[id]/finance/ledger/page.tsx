import { redirect } from 'next/navigation';

import {
  financeProjectRedirects,
  withQuery,
  type RouteSearchParams,
} from '@/features/finance-projects/redirects';

/** ADR-043 Phase 3 — the project ledger now sits under Finance → Projects → P&L. */
export default async function LegacyLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const { id } = await params;
  redirect(withQuery(financeProjectRedirects.ledger(id), await searchParams));
}
