import { Suspense } from 'react';

import { TransfersList } from '@/features/bank-transfers/transfers-list';

export default function TransfersPage() {
  return (
    <Suspense>
      <div className="w-full min-w-0 max-w-6xl">
        <TransfersList />
      </div>
    </Suspense>
  );
}
