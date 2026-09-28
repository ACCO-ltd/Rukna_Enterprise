import { ProgressShell } from '@/features/progress/components/progress-shell';

export default async function ProgressLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProgressShell projectId={id}>{children}</ProgressShell>;
}
