import { BankAccountPage } from '@/features/accounting/components/bank-account-page';

export default async function BankAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="w-full max-w-6xl">
      <BankAccountPage id={id} />
    </div>
  );
}
