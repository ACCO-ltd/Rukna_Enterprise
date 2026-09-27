import type { StatusTone } from '@erp/ui';
import type { ProjectRequirementRow } from '@erp/types';

/**
 * Requirement priority is a marker, not a lifecycle status (ADR-034), so it has no registry
 * vocabulary and renders as a plain badge without a dot. LOW and NORMAL are the default and say
 * nothing; only HIGH and URGENT earn a colour.
 *
 * The approval and fulfilment statuses take their tones from the status registry
 * (`requirementApproval`, `requirementFulfilment`), never from this file.
 */
export const PRIORITY_TONE: Record<ProjectRequirementRow['priority'], StatusTone> = {
  LOW: 'neutral',
  NORMAL: 'neutral',
  HIGH: 'attention',
  URGENT: 'danger',
};
