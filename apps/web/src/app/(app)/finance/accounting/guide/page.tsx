import { GuideHub } from '@/features/accounting/components/guide-hub';

/**
 * The Accounting "Get started" hub. A launchpad for the four accounting cycles, and the module's
 * default landing while setup is incomplete (see `/accounting`'s conditional redirect).
 */
export default function AccountingGuidePage() {
  return (
    <div className="w-full max-w-4xl">
      <GuideHub />
    </div>
  );
}
