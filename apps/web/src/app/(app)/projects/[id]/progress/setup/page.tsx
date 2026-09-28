import { ProgressViewGate } from '@/features/progress/components/progress-shell';
import { PlanView } from '@/features/progress/components/programme-section';

export default async function ProgressSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ProgressViewGate projectId={id} view="setup">
      <PlanView projectId={id} />
    </ProgressViewGate>
  );
}
