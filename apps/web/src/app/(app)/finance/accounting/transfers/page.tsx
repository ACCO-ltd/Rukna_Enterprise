import { Suspense } from 'react';

import { TransfersList } from '@/features/bank-transfers/transfers-list';

export default function TransfersPage() {
  return (
    <Suspense>
      <TransfersList />
    </Suspense>
  );
}
