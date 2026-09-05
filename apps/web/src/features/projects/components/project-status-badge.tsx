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
  [ProjectStatus.ACTIVE]: 'live',
  // A milestone reached, not a problem: amber here read as a warning about a project that
  // had just achieved something. Violet keeps it distinct from CLOSEOUT (which genuinely is
  // amber, being work outstanding) without borrowing the interaction blue.
  [ProjectStatus.PRACTICAL_COMPLETION]: 'accent',
  [ProjectStatus.CLOSEOUT]: 'warning',
  [ProjectStatus.CLOSED]: 'neutral',
  [ProjectStatus.CANCELLED]: 'danger',
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const t = useTranslations('platform.projects.status');

  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{t(status)}</Badge>;
}
