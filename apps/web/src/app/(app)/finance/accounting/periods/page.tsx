import { GuideHint } from '@/features/accounting/components/guide-hint';
import { FiscalPeriods } from '@/features/accounting/components/fiscal-periods';

export default function FiscalPeriodsPage() {
  return (
    <div className="w-full max-w-5xl">
      {/* Month-end lives here: whichever of lock → close is the live next step is surfaced. */}
      <GuideHint cycleKey="month_end" stepKey={['lock-period', 'close-period']} />
      <FiscalPeriods />
    </div>
  );
}
