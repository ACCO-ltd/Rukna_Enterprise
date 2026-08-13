import { ProjectPlContent } from '@/features/projects/components/project-pl-content';

export default async function ProjectPlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectPlContent projectId={id} />;
}
