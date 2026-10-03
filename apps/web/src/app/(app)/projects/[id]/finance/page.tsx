import { redirect } from 'next/navigation';

import {
  financeProjectRedirects,
  withQuery,
  type RouteSearchParams,
} from '@/features/finance-projects/redirects';

/**
 * ADR-043 Phase 3 — the project Finance tab is retired; a project's money is read in Finance →
 * Projects. Kept as a server redirect so bookmarks, notifications and old links still land.
 * A reader without the finance permission lands on Finance's own no-access state.
 */
export default async function LegacyProjectFinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const { id } = await params;
  redirect(withQuery(financeProjectRedirects.overview(id), await searchParams));
}
