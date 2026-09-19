import { ProcurementOverviewPageContent } from '@/features/procurement/components/project/procurement-overview-page-content';

export default async function ProjectProcurementOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProcurementOverviewPageContent projectId={id} />;
}
