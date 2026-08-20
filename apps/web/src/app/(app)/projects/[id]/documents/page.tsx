import { DocumentsTab } from '@/features/documents/components/documents-tab';

export default async function ProjectDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DocumentsTab projectId={id} />;
}
