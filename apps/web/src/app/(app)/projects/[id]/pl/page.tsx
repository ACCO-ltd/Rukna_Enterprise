import { redirect } from 'next/navigation';

import {
  financeProjectRedirects,
  withQuery,
  type RouteSearchParams,
} from '@/features/finance-projects/redirects';

/**
 * The oldest project P&L URL. It first moved under the project Finance tab; since ADR-043 Phase 3
 * the P&L lives in Finance → Projects, so it goes straight there (one hop, not two).
 */
export default async function LegacyProjectPlPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const { id } = await params;
  redirect(withQuery(financeProjectRedirects.profitLoss(id), await searchParams));
}
