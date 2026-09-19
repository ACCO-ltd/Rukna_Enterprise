import { PurchasesViewShell } from '@/features/procurement/components/project/purchases-view-shell';

export default async function ProjectProcurementPurchasesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PurchasesViewShell projectId={id} />;
}
