import { AccountingLanding } from '@/features/accounting/components/accounting-landing';

/**
 * The accounting module's entry route. It no longer redirects unconditionally to the journal
 * list — it lands on the "Get started" hub while setup is incomplete and on the daily workspace
 * once the ledger can post. The decision needs the live guide (a client, permission-gated read),
 * so the choice is made in `AccountingLanding`.
 */
export default function AccountingPage() {
  return <AccountingLanding />;
}
