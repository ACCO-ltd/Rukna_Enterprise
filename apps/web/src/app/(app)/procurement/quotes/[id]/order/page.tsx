import { OrderAdjustScreen } from '@/features/procurement/components/quotes/order-adjust-screen';

/** Adjust the order's lines before raising it from a quotation award (ADR-044 §8). */
export default async function QuoteOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderAdjustScreen id={id} />;
}
