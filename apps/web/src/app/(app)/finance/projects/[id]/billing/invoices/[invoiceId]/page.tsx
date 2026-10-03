import { ProjectInvoicePage } from '@/features/commercial/components/project-invoice-page';

/**
 * ADR-043 Phase 3 — a project's client invoice inside Finance → Projects → Billing: the same
 * document page (issue, send, record payment, credit note, collection notes) that used to sit
 * under the project's Commercial tab, now with its way back to Finance.
 */
export default async function FinanceProjectInvoicePage({
  params,
}: {
  params: Promise<{ id: string; invoiceId: string }>;
}) {
  const { id, invoiceId } = await params;
  return <ProjectInvoicePage projectId={id} invoiceId={invoiceId} />;
}
