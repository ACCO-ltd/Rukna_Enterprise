import { GuideHint } from '@/features/accounting/components/guide-hint';
import { InvoicesList } from '@/features/accounting/components/invoices-list';

export default function InvoicesPage() {
  return (
    <>
      <GuideHint cycleKey="daily" stepKey="invoices" />
      <InvoicesList />
    </>
  );
}
