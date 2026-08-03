import { ProjectDetail } from '@/features/projects/components/project-detail';

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <ProjectDetail id={id} />
    </div>
  );
}
