import { redirect } from 'next/navigation';

import { financeProjectRedirects, withQuery, type RouteSearchParams } from '@/features/finance-projects/redirects';

/** The retired Payables tab (ADR-043 amendment, 2026-10-10) — now a Transactions view. */
export default async function LegacyFinanceProjectPayablesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const { id } = await params;
  redirect(withQuery(financeProjectRedirects.transactions(id, 'bills'), await searchParams));
}
