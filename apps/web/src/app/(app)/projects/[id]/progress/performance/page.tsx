import { ProgressViewGate } from '@/features/progress/components/progress-shell';
import { PerformanceView } from '@/features/progress/components/performance-view';

export default async function ProgressPerformancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <ProgressViewGate projectId={id} view="performance">
      <PerformanceView projectId={id} />
    </ProgressViewGate>
  );
}
