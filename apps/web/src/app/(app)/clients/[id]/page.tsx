import { ClientDetail } from '@/features/clients/components/client-detail';

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <ClientDetail clientId={id} />
    </div>
  );
}
