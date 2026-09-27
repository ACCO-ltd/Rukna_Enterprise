import { ClientEdit } from '@/features/clients/components/client-edit';

/**
 * The Projects module header owns the page's `h1`; `ClientEdit` names the client in its
 * breadcrumb (ADR-035). The form opens with its own sticky action bar (ADR-037).
 */
export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="w-full max-w-4xl">
      {/* The loading and error states ClientEdit shows first are deliberately bare, so a
          failure is not dressed as a form. */}
      <ClientEdit id={id} />
    </div>
  );
}
