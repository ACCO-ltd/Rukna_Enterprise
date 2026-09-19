import { RequirementsView } from '@/features/procurement/components/project/requirements-view';

export default async function ProjectProcurementRequestsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RequirementsView projectId={id} />;
}
