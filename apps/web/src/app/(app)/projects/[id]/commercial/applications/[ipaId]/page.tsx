import { ProjectApplicationDetail } from '@/features/commercial/components/project-application-detail';

/**
 * Payment application (IPA) detail inside the project Commercial workspace (P3 Slice C).
 *
 * The contract is resolved from the commercial summary by the client wrapper; only the project and
 * the application id travel in the URL.
 */
export default async function ProjectApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string; ipaId: string }>;
}) {
  const { id, ipaId } = await params;

  return (
    <div className="w-full max-w-5xl">
      <ProjectApplicationDetail projectId={id} ipaId={ipaId} />
    </div>
  );
}
