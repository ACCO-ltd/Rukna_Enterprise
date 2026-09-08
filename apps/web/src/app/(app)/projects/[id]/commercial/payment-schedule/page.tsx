import { CommercialWorkspace } from '@/features/commercial/components/commercial-workspace';

export default async function PaymentSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CommercialWorkspace projectId={id} active="payment-schedule" />;
}
