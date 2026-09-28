import { ProgressViewGate } from '@/features/progress/components/progress-shell';
import { ReviewSection } from '@/features/progress/components/review-section';

export default async function ProgressReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ProgressViewGate projectId={id} view="review">
      <ReviewSection projectId={id} />
    </ProgressViewGate>
  );
}
