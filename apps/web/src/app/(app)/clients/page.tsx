import { ClientsList } from '@/features/clients/components/clients-list';

/**
 * The Projects module header owns the page's `h1` and names this page in its breadcrumb
 * (ADR-035); the "New client" action sits in the list's toolbar.
 */
export default function ClientsPage() {
  return <ClientsList />;
}
