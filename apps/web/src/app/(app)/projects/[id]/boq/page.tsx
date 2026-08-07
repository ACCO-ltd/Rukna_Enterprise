import { BoqPanel } from '@/features/boq/components/boq-panel';

export default async function BoqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BoqPanel projectId={id} />;
}
