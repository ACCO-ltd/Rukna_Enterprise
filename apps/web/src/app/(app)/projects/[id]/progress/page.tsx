import { ProgressLanding } from '@/features/progress/components/progress-shell';

/**
 * `/progress` has no content of its own: it sends the reader to their landing view. The choice
 * needs the session's permissions and the project's setup state, both client-side, so the
 * redirect happens in `ProgressLanding` rather than here.
 */
export default async function ProjectProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProgressLanding projectId={id} />;
}
