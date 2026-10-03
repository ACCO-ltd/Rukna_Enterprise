import { redirect } from 'next/navigation';

import {
  financeProjectRedirects,
  withQuery,
  type RouteSearchParams,
} from '@/features/finance-projects/redirects';

/**
 * Legacy IPA / IPC list. ACCO bills by milestone, not by certificate, so the old route lands on the
 * project's Commercial tab (which still offers Applications for a measured contract). Kept as a
 * redirect so existing links still resolve.
 */
export default async function ProjectIpcPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const { id } = await params;
  redirect(withQuery(financeProjectRedirects.ipc(id), await searchParams));
}
