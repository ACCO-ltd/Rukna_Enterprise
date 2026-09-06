import type { BadgeTone } from '@erp/ui';
import type { ProjectRequirementRow } from '@erp/types';

/**
 * Badge tones for the two requirement states, kept in one place because the list and the detail
 * panel must not colour the same status differently.
 *
 * Approval and fulfilment stay separate everywhere — they are different questions, and a single
 * "Status" column answers neither cleanly.
 */
export const APPROVAL_TONE: Record<ProjectRequirementRow['approvalStatus'], BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  APPROVED: 'live',
  CANCELLED: 'historical',
  CLOSED: 'historical',
};

export const FULFILMENT_TONE: Record<ProjectRequirementRow['fulfillmentStatus'], BadgeTone> = {
  NOT_ORDERED: 'neutral',
  PARTIALLY_ORDERED: 'warning',
  FULLY_ORDERED: 'live',
};

/** LOW and NORMAL are the default and say nothing; only HIGH and URGENT earn a colour. */
export const PRIORITY_TONE: Record<ProjectRequirementRow['priority'], BadgeTone> = {
  LOW: 'neutral',
  NORMAL: 'neutral',
  HIGH: 'warning',
  URGENT: 'danger',
};
