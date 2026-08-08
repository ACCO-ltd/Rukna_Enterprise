import { JournalDetail } from '@/features/accounting/components/journal-detail';

export default async function JournalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <JournalDetail journalId={id} />
    </div>
  );
}
