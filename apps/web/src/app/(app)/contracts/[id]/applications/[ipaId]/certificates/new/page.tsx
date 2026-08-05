import { IpcWizard } from '@/features/ipc/wizard/ipc-wizard';

interface Props {
  params: Promise<{ id: string; ipaId: string }>;
}

export default async function IssueCertificatePage({ params }: Props) {
  const { id, ipaId } = await params;
  return <IpcWizard contractId={id} ipaId={ipaId} />;
}
