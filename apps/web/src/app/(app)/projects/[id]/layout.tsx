import { ProjectWorkspaceShell } from '@/components/layout/project-workspace-shell';

export default async function ProjectWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectWorkspaceShell id={id}>{children}</ProjectWorkspaceShell>;
}
