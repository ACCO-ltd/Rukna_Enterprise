import { RecordSignedContractForm } from '@/features/contracts/components/record-signed-contract-form';

/**
 * Record signed contract — a page inside the Commercial tab. The form carries its own action bar
 * (back to Commercial, Record, Cancel), title and "what gets recorded" rail.
 */
export default async function NewProjectContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RecordSignedContractForm projectId={id} />;
}
