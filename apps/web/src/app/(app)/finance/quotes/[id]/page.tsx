import { QuoteDecisionScreen } from '@/features/procurement/components/quotes/decision-screen';

/**
 * The decision screen (ADR-044 wireframe E). The in-app notification's `actionUrl` — and the
 * WhatsApp link in phase 2 — open this route directly; signing in returns here (`?next=`).
 */
export default async function FinanceQuoteDecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="w-full max-w-7xl">
      <QuoteDecisionScreen id={id} />
    </div>
  );
}
