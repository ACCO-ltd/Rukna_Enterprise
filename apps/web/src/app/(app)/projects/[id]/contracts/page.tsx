import { redirect } from 'next/navigation';

import {
  financeProjectRedirects,
  withQuery,
  type RouteSearchParams,
} from '@/features/finance-projects/redirects';

/**
 * Legacy project contracts list. A contract is read at Commercial → Contract; one hop (it used to
 * go via /commercial/main-contract, itself a redirect).
 */
export default async function ProjectContractsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const { id } = await params;
  redirect(withQuery(financeProjectRedirects.contracts(id), await searchParams));
}
