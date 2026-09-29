import { GuideHint } from '@/features/accounting/components/guide-hint';
import { JournalsList } from '@/features/accounting/components/journals-list';

export default function JournalsPage() {
  return (
    <div className="w-full max-w-6xl">
      <GuideHint cycleKey="daily" stepKey="journals" />
      <JournalsList />
    </div>
  );
}
