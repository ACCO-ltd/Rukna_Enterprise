import { PurchaseCreateShell } from '@/features/procurement/components/project/purchase-create-shell';

export default async function NewProjectPurchasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PurchaseCreateShell projectId={id} />;
}
