import { LinkedAttachmentsView } from '@/features/documents/components/linked-attachments-view';

export default async function ProjectLinkedAttachmentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LinkedAttachmentsView projectId={id} />;
}
