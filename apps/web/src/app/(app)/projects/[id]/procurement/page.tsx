import { ProjectProcurementTab } from '@/features/procurement/components/project-procurement-tab';

export default async function ProjectProcurementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectProcurementTab projectId={id} />;
}
