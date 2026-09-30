import { GuideHint } from '@/features/accounting/components/guide-hint';
import { PostingProfiles } from '@/features/accounting/components/posting-profiles';

export default function PostingProfilesPage() {
  return (
    <div className="w-full max-w-6xl">
      <GuideHint cycleKey="setup" stepKey="posting-profiles" />
      <PostingProfiles />
    </div>
  );
}
