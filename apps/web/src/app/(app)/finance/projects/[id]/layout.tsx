import { FinanceProjectWorkspace } from '@/features/finance-projects/components/finance-project-workspace';

export default async function FinanceProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FinanceProjectWorkspace projectId={id}>{children}</FinanceProjectWorkspace>;
}
