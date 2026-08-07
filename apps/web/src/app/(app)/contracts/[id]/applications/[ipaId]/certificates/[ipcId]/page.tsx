import { IpcDetail } from '@/features/ipc/components/ipc-detail';

interface Props {
  params: Promise<{ id: string; ipaId: string; ipcId: string }>;
}

export default async function CertificateDetailPage({ params }: Props) {
  const { id, ipaId, ipcId } = await params;
  return <IpcDetail contractId={id} ipaId={ipaId} ipcId={ipcId} />;
}
