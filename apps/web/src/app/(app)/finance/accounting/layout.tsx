import { AccountingCycleStrip } from '@/features/finance/components/accounting-cycle-strip';

/**
 * Layout for every `/finance/accounting/*` screen.
 *
 * Renders the persistent cycle-status strip above the page — the current period, its status and
 * the count of items awaiting the user — so a person always knows where the accounting cycle
 * stands without leaving the screen they are on. The strip hides itself on the guide hub, where
 * that same information is the page.
 */
export default function AccountingSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AccountingCycleStrip />
      {children}
    </>
  );
}
