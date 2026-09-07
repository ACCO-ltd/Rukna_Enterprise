import { DocumentsShell } from '@/features/documents/components/documents-shell';

export default async function DocumentsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DocumentsShell projectId={id}>{children}</DocumentsShell>;
}
