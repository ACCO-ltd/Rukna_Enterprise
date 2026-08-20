import { ProjectFinancialPositionCard } from '@/features/projects/components/project-financial-position-card';
import { ProjectPlContent } from '@/features/projects/components/project-pl-content';
import { PhysicalFinancialSignalBanner } from '@/features/progress/components/physical-financial-signal-banner';
import { CollectionProgressSignalBanner } from '@/features/progress/components/collection-progress-signal-banner';

export default async function ProjectPlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="space-y-10">
      <ProjectFinancialPositionCard projectId={id} />
      {/* Two ADR-021/023 early-warnings, read from backend signal read models (no client-side
          financial ratios): cost-vs-progress, then collection-vs-progress. Both sit under the
          Financial Position they draw from. */}
      <div className="space-y-4">
        <PhysicalFinancialSignalBanner projectId={id} />
        <CollectionProgressSignalBanner projectId={id} />
      </div>
      <ProjectPlContent projectId={id} />
    </div>
  );
}
