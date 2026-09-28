import { ProgressViewGate } from '@/features/progress/components/progress-shell';
import { TodaySection } from '@/features/progress/components/today-section';

export default async function ProgressTodayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ProgressViewGate projectId={id} view="today">
      <TodaySection projectId={id} />
    </ProgressViewGate>
  );
}
