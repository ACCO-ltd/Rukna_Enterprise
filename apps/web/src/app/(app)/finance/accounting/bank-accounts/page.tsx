import { BankAccounts } from '@/features/accounting/components/bank-accounts';
import { isCashAccountPreset } from '@/features/accounting/bank-account-setup';

/** `?preset=cash-box | evc-float` opens the create form filled (ADR-045 P14, from a payment blocker). */
export default async function BankAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string }>;
}) {
  const { preset } = await searchParams;
  return (
    <div className="w-full max-w-5xl">
      <BankAccounts preset={isCashAccountPreset(preset) ? preset : null} />
    </div>
  );
}
