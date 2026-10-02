import { ClientRecord } from '@/features/clients/components/client-record';

/**
 * The client record carries its own breadcrumbs and `h1`: the module header and tabs stand
 * aside here (`hasOwnWorkspace` in module-nav), so the record is one page with no tab bar.
 */
export default async function ClientRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <ClientRecord clientId={id} />;
}
