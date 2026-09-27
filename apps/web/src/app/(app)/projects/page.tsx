import { ProjectsList } from '@/features/projects/components/projects-list';

/**
 * The Projects module header owns the page's `h1` and names this page in its breadcrumb
 * (ADR-035); the "New project" action sits in the list's toolbar.
 */
export default function ProjectsPage() {
  return <ProjectsList />;
}
