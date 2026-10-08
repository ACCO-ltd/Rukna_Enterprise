import { PaymentsQueue } from '@/features/procurement/components/quotes/payments-queue';

/**
 * Finance → Payables → Payments needed (ADR-045 §6): award orders to pay and store receipts to
 * record, longest wait first. `?queue=settle` opens the second tab (notification links).
 */
export default async function PaymentsNeededPage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string }>;
}) {
  const { queue } = await searchParams;
  return (
    <div className="w-full max-w-6xl">
      <PaymentsQueue initialQueue={queue === 'settle' ? 'settle' : 'pay'} />
    </div>
  );
}
