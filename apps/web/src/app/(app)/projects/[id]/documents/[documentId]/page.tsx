import { DocumentDetailView } from '@/features/documents/components/document-detail-view';

export default async function ProjectDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>;
}) {
  const { id, documentId } = await params;
  return <DocumentDetailView projectId={id} documentId={documentId} />;
}
