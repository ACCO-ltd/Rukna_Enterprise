import { Suspense } from 'react';

import { ClientStatement } from '@/features/client-statement/client-statement';

export default function ClientStatementPage() {
  return (
    <Suspense>
      <ClientStatement />
    </Suspense>
  );
}
