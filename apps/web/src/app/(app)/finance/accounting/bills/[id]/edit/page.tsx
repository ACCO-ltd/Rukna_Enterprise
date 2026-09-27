import { SupplierBillEditPage } from '@/features/procurement/components/bill-create-form';

/**
 * Edit a draft supplier bill (ADR-037 amendment) — a new draft, or one returned for correction.
 * The same form as the create page, prefilled from the bill; anything but a DRAFT is refused
 * with a notice and a link back.
 */
export default async function EditSupplierBillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="w-full max-w-6xl">
      <SupplierBillEditPage id={id} />
    </div>
  );
}
