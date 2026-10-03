import { redirect } from 'next/navigation';

import {
  financeProjectRedirects,
  withQuery,
  type RouteSearchParams,
} from '@/features/finance-projects/redirects';

/** ADR-043 Phase 3 — a bill opened from the old project ledger opens on the accounting bill page. */
export default async function LegacyProjectBillRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; billId: string }>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const { billId } = await params;
  redirect(withQuery(financeProjectRedirects.bill(billId), await searchParams));
}
