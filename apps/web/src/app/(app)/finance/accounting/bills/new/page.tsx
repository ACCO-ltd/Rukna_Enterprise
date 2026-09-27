import { SupplierBillCreateForm } from '@/features/procurement/components/bill-create-form';

/**
 * New supplier bill (ADR-037). One page for both kinds of bill; the kind is the form's first
 * question. `?po=1` opens it with "Against a purchase order" chosen, so the list's
 * "New PO bill" action and any existing link keep landing where they did.
 */
export default async function NewSupplierBillPage({
  searchParams,
}: {
  searchParams: Promise<{ po?: string }>;
}) {
  const { po } = await searchParams;

  return (
    <div className="w-full max-w-6xl">
      <SupplierBillCreateForm initialKind={po === '1' ? 'po' : 'direct'} />
    </div>
  );
}
