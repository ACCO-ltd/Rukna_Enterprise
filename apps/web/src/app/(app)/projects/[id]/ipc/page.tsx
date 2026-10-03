import { redirect } from 'next/navigation';

import { financeProjectRedirects } from '@/features/finance-projects/redirects';

/**
 * Legacy IPA / IPC list. ACCO bills by milestone, not by certificate, so the old route lands on the
 * project's Commercial tab (which still offers Applications for a measured contract). Kept as a
 * redirect so existing links still resolve.
 */
export default async function ProjectIpcPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(financeProjectRedirects.ipc(id));
}
