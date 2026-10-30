import { SupplierPaymentForm } from '@/features/procurement/components/payment-form';

/** `?supplier=&bill=&amount=` opens the form for one bill — the bill page's Pay bill (SB-2). */
export default async function NewSupplierPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string; bill?: string; amount?: string }>;
}) {
  const { supplier, bill, amount } = await searchParams;
  const amountValid = amount && /^\d+(\.\d{1,2})?$/.test(amount) ? amount : undefined;

  return (
    <div className="w-full max-w-4xl">
      <SupplierPaymentForm prefill={supplier ? { supplierId: supplier, billId: bill, amount: amountValid } : undefined} />
    </div>
  );
}
