import { ProjectStatus } from '@erp/types';
import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

/**
 * Colour carries emphasis, never meaning on its own — the label is always present, so the
 * badge stays readable for colour-blind users and in monochrome print.
 */
const STATUS_STYLES: Record<ProjectStatus, string> = {
  [ProjectStatus.DRAFT]: 'bg-muted text-muted-foreground',
  [ProjectStatus.APPROVED]: 'bg-brand-primary/10 text-brand-primary',
  [ProjectStatus.MOBILIZING]: 'bg-brand-accent/10 text-brand-accent',
  [ProjectStatus.ACTIVE]: 'bg-brand-primary/15 text-brand-primary',
  [ProjectStatus.PRACTICAL_COMPLETION]: 'bg-warning-subtle text-warning',
  [ProjectStatus.CLOSEOUT]: 'bg-warning-subtle text-warning',
  [ProjectStatus.CLOSED]: 'bg-muted text-muted-foreground',
  [ProjectStatus.CANCELLED]: 'bg-danger-subtle text-danger',
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const t = useTranslations('platform.projects.status');

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {t(status)}
    </span>
  );
}
