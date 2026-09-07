import { DocumentRegisterView } from '@/features/documents/components/document-register-view';

export default async function ProjectDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DocumentRegisterView projectId={id} />;
}
