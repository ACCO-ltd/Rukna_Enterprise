import { ProgressViewGate } from '@/features/progress/components/progress-shell';
import { SetupView } from '@/features/progress/components/setup-view';

export default async function ProgressSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ProgressViewGate projectId={id} view="setup">
      <SetupView projectId={id} />
    </ProgressViewGate>
  );
}
