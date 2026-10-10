import { redirect } from 'next/navigation';

import { financeProjectRedirects, withQuery, type RouteSearchParams } from '@/features/finance-projects/redirects';

/** The retired P&L tab (ADR-043 amendment, 2026-10-10) — now a Transactions view. */
export default async function LegacyFinanceProjectPlPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const { id } = await params;
  redirect(withQuery(financeProjectRedirects.transactions(id, 'pl'), await searchParams));
}
