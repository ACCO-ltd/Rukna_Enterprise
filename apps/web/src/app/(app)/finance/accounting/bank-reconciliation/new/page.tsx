import { Suspense } from 'react';

import { StatementImport } from '@/features/bank-reconciliation/statement-import';

export default function ImportStatementPage() {
  return (
    <Suspense>
      <StatementImport />
    </Suspense>
  );
}
