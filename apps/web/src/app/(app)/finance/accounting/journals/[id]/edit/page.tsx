import { JournalEditPage } from '@/features/accounting/components/journal-edit-page';

export default async function EditJournalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="w-full max-w-5xl">
      <JournalEditPage journalId={id} />
    </div>
  );
}
