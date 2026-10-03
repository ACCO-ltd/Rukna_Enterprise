import { redirect } from 'next/navigation';

import { financeProjectRedirects } from '@/features/finance-projects/redirects';

/**
 * Legacy project contracts list. A contract is read at Commercial → Contract; one hop (it used to
 * go via /commercial/main-contract, itself a redirect).
 */
export default async function ProjectContractsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(financeProjectRedirects.contracts(id));
}
