import { Suspense } from 'react';

import { JournalsPage as Journals } from '@/features/accounting/components/journals-list';

export default function JournalsPage() {
  return (
    <div className="w-full min-w-0 max-w-6xl">
      <Suspense>
        <Journals />
      </Suspense>
    </div>
  );
}
