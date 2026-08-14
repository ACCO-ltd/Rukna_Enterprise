import { BoqWorkspace } from '@/features/boq/components/boq-workspace';

export default async function BoqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BoqWorkspace projectId={id} />;
}
