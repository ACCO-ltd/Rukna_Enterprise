import { redirect } from 'next/navigation';

/**
 * The old reports hub. Every report it linked to is in the Accounting module's Reports tab
 * (ADR-035), so a second index would be a second navigation system. Kept as a redirect so old
 * bookmarks land on a report rather than a 404.
 */
export default function AccountingReportsPage() {
  redirect('/finance/accounting/trial-balance');
}
