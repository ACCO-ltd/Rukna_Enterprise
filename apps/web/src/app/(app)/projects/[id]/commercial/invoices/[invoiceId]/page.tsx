import { ProjectInvoicePage } from '@/features/commercial/components/project-invoice-page';

export default async function ProjectInvoiceRoute({
  params,
}: {
  params: Promise<{ id: string; invoiceId: string }>;
}) {
  const { id, invoiceId } = await params;
  return <ProjectInvoicePage projectId={id} invoiceId={invoiceId} />;
}
