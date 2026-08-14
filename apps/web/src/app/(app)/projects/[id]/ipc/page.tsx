import { redirect } from 'next/navigation';

/**
 * Absorbed into the Commercial workspace.
 *
 * Applications and certificates are now read at Commercial → Applications & Certificates,
 * which shows the whole chain — application, certificate, invoice, settlement — rather than
 * an IPA list with certificates joined client-side. Kept as a redirect so existing links
 * still resolve.
 */
export default async function ProjectIpcPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/commercial/applications`);
}
