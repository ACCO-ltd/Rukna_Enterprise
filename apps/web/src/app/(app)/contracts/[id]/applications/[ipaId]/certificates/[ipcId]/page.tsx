import { IpcDetail } from '@/features/ipc/components/ipc-detail';

export default async function IpcDetailPage({
  params,
}: {
  params: Promise<{ id: string; ipaId: string; ipcId: string }>;
}) {
  const { id, ipaId, ipcId } = await params;

  return (
    <div className="w-full max-w-5xl">
      <IpcDetail contractId={id} ipaId={ipaId} ipcId={ipcId} />
    </div>
  );
}
