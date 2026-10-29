import { Suspense } from 'react';

import { SupplierStatement } from '@/features/supplier-statement/supplier-statement';

export default function SupplierStatementPage() {
  return (
    <Suspense>
      <SupplierStatement />
    </Suspense>
  );
}
