import { redirect } from 'next/navigation';

/**
 * The standalone `/contracts/new` page is retired (P3 Slice B): contract creation now lives in
 * the project's Commercial workspace. This route only catches legacy links.
 *
 *  - `?projectId=…` present → forward into that project's workspace create page.
 *  - absent → a contract cannot be created without a project, so land the user on Projects to
 *    pick one rather than opening a create form with no context.
 *
 * A server `redirect()` (not a client boundary) because the destination is decided entirely from
 * the query string the URL already carries.
 */
export default async function LegacyNewContractPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;

  if (projectId) {
    redirect(`/projects/${projectId}/commercial/contract/new`);
  }

  redirect('/projects');
}
