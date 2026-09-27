import { ProjectForm } from '@/features/projects/components/project-form';

/**
 * The Projects module header owns the page's `h1` (ADR-035); the form names itself in the
 * breadcrumb and opens with its own sticky action bar and record header (ADR-037).
 */
export default function NewProjectPage() {
  return (
    <div className="w-full max-w-4xl">
      <ProjectForm />
    </div>
  );
}
