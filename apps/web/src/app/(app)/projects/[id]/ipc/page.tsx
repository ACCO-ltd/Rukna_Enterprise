import { ProjectIpcContent } from '@/features/projects/components/project-ipc-content';

export default async function ProjectIpcPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectIpcContent projectId={id} />;
}
