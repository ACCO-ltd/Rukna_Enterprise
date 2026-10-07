import { QuotesInbox } from '@/features/procurement/components/quotes/quotes-inbox';

/** Finance → Payables → Quotes to choose (ADR-044): the decide queue, longest wait first. */
export default function FinanceQuotesPage() {
  return (
    <div className="w-full max-w-6xl">
      <QuotesInbox />
    </div>
  );
}
