import { ProjectInvoiceRedirect } from '@/features/finance-projects/components/project-invoice-redirect';

/**
 * ADR-043 Phase 3 — a project invoice now opens in Finance. Who may go there is a client-side
 * permission (the session lives in the browser), so this route hands off to a small client
 * redirect: finance → the invoice in Finance; everyone else → the Commercial schedule, which
 * shows the stage's money-free status.
 */
export default async function ProjectInvoiceRoute({
  params,
}: {
  params: Promise<{ id: string; invoiceId: string }>;
}) {
  const { id, invoiceId } = await params;
  return <ProjectInvoiceRedirect projectId={id} invoiceId={invoiceId} />;
}
