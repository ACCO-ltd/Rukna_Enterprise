import { FinanceShell } from '@/features/finance/components/finance-shell';

export default async function FinanceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FinanceShell projectId={id}>{children}</FinanceShell>;
}
