import { redirect } from 'next/navigation';

/**
 * Absorbed into the Commercial workspace.
 *
 * The project-scoped contracts list was one of three entries in a Commercial dropdown that
 * duplicated the Commercial workspace's own sub-navigation. A contract is now read at
 * Commercial → Main Contract. The route is kept as a redirect so existing links, bookmarks
 * and anything that deep-links here still land somewhere correct.
 */
export default async function ProjectContractsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${id}/commercial/main-contract`);
}
