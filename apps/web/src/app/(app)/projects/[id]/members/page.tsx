import { ProjectMembers } from '@/features/projects/components/project-members';

export default async function ProjectMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ProjectMembers projectId={id} />;
}
