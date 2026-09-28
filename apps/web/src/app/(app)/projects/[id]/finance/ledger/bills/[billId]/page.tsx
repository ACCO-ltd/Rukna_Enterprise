import { ProjectBillPage } from '@/features/finance/components/project-bill-page';

export default async function ProjectBillRoute({
  params,
}: {
  params: Promise<{ id: string; billId: string }>;
}) {
  const { id, billId } = await params;
  return <ProjectBillPage projectId={id} billId={billId} />;
}
