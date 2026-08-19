import { ProjectFinancialPositionCard } from '@/features/projects/components/project-financial-position-card';
import { ProjectPlContent } from '@/features/projects/components/project-pl-content';
import { PhysicalFinancialSignalBanner } from '@/features/progress/components/physical-financial-signal-banner';

export default async function ProjectPlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="space-y-10">
      <ProjectFinancialPositionCard projectId={id} />
      {/* ADR-021 early-warning: built % vs cost consumed %, read from the same signal the
          Progress tab and Overview card show. Sits under Financial Position (its cost source). */}
      <PhysicalFinancialSignalBanner projectId={id} />
      <ProjectPlContent projectId={id} />
    </div>
  );
}
