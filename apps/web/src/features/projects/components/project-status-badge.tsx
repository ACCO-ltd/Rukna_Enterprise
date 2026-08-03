import { ProjectStatus } from '@erp/types';
import { useTranslations } from 'next-intl';
import { Badge, type BadgeTone } from '@erp/ui';

/**
 * Where each project status sits in its lifecycle. The tone vocabulary and the styling
 * live in `Badge`, so every status machine in the platform reads the same way.
 *
 * Colour carries emphasis, never meaning on its own — the label is always present, so the
 * badge stays readable for colour-blind users and in monochrome print.
 */
const STATUS_TONES: Record<ProjectStatus, BadgeTone> = {
  [ProjectStatus.DRAFT]: 'neutral',
  [ProjectStatus.APPROVED]: 'info',
  [ProjectStatus.MOBILIZING]: 'accent',
  [ProjectStatus.ACTIVE]: 'live',
  [ProjectStatus.PRACTICAL_COMPLETION]: 'warning',
  [ProjectStatus.CLOSEOUT]: 'warning',
  [ProjectStatus.CLOSED]: 'neutral',
  [ProjectStatus.CANCELLED]: 'danger',
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const t = useTranslations('platform.projects.status');

  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{t(status)}</Badge>;
}
