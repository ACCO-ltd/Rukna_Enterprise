import { Suspense } from 'react';

import { QuoteCaptureScreen } from '@/features/procurement/components/quotes/capture-screen';

/** The capture / waiting screen for one quotation request (ADR-044, wireframes B and C). */
export default async function QuoteCapturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    // useSearchParams (the ?store= hand-off from "Get quotes") needs a Suspense boundary.
    <Suspense>
      <QuoteCaptureScreen id={id} />
    </Suspense>
  );
}
