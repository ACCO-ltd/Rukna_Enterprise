import { SupplierCreateForm } from '@/features/procurement/components/supplier-create-form';

/** New supplier (ADR-037) — a full page, reached from the Suppliers list's "New supplier". */
export default function NewSupplierPage() {
  return (
    <div className="w-full max-w-3xl">
      <SupplierCreateForm />
    </div>
  );
}
