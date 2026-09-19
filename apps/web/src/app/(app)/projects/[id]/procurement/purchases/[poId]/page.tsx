import { PurchaseDetailShell } from '@/features/procurement/components/project/purchase-detail-shell';

export default async function ProjectProcurementPurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string; poId: string }>;
}) {
  const { id, poId } = await params;
  return <PurchaseDetailShell projectId={id} poId={poId} />;
}
