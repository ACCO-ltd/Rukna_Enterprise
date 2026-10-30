import { Suspense } from 'react';

import { StatementsList } from '@/features/bank-reconciliation/statements-list';

export default function BankReconciliationPage() {
  return (
    <Suspense>
      <StatementsList />
    </Suspense>
  );
}
