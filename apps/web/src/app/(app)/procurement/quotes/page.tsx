import { QuotesList } from '@/features/procurement/components/quotes/quotes-list';

/** Procurement → Quotes (ADR-044): the buyer's queues of quotation requests. */
export default function ProcurementQuotesPage() {
  return (
    <div className="w-full max-w-6xl">
      <QuotesList />
    </div>
  );
}
