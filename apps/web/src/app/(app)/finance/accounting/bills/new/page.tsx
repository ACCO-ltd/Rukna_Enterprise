import { SupplierBillForm } from '@/features/procurement/components/bill-form';
import { PoSupplierBillForm } from '@/features/procurement/components/po-bill-form';

/**
 * Two distinct controlled paths behind one route (D6):
 *  - `?po=1` → the PO-backed bill that auto-matches on submit.
 *  - default → the genuine non-PO bill (utilities, rent, one-off), which never matches.
 */
export default async function NewSupplierBillPage({
  searchParams,
}: {
  searchParams: Promise<{ po?: string }>;
}) {
  const { po } = await searchParams;
  const poBacked = po === '1';

  return (
    <div className="mx-auto w-full max-w-4xl">
      {poBacked ? <PoSupplierBillForm /> : <SupplierBillForm />}
    </div>
  );
}
