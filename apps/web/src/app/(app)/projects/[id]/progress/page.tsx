import { ProgressTab } from '@/features/progress/components/progress-tab';

export default async function ProjectProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProgressTab projectId={id} />;
}
