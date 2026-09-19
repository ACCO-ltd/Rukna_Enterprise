import type { ReactNode } from 'react';
import { ProcurementSubShell } from '@/features/procurement/components/project/procurement-sub-shell';

export default async function ProjectProcurementLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProcurementSubShell projectId={id}>{children}</ProcurementSubShell>;
}
