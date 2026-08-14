import { ProjectFinancialPositionCard } from '@/features/projects/components/project-financial-position-card';
import { ProjectPlContent } from '@/features/projects/components/project-pl-content';

export default async function ProjectPlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="space-y-10">
      <ProjectFinancialPositionCard projectId={id} />
      <ProjectPlContent projectId={id} />
    </div>
  );
}
