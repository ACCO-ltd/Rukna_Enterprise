/**
 * Step 1b (ADR-047): the Rukna platform defaults for the company templates. A company starts on
 * these; it may save its own copy (Administration → Templates) and reset back here at any time.
 * Pure data — no Prisma, no I/O.
 */

import type { PaymentPlanTemplateRow, ScheduleTemplatePhaseDto } from '@erp/types';

/** The standard 40/30/20/10 stage payment plan: an advance, then three work-stage milestones. */
export const DEFAULT_PAYMENT_PLAN: readonly PaymentPlanTemplateRow[] = [
  { name: 'Advance (mobilisation)', percentage: '40', isAdvance: true },
  { name: 'Partition & Plastering', percentage: '30', isAdvance: false },
  { name: 'Installation & Paint', percentage: '20', isAdvance: false },
  { name: 'Inspection & Handover', percentage: '10', isAdvance: false },
];

/**
 * The standard building schedule. Order is the phase sequence — applied work packages are
 * auto-numbered WP-01… in this order. Design and Mobilization are `scheduleOnly` (no BOQ scope).
 */
export const DEFAULT_BUILDING_PHASES: readonly ScheduleTemplatePhaseDto[] = [
  { name: 'Design Completion (2D & 3D)', durationDays: 7, scheduleOnly: true },
  { name: 'Mobilization & Site Preparation', durationDays: 7, scheduleOnly: true },
  { name: 'Excavation & Foundation Works', durationDays: 21, scheduleOnly: false },
  { name: 'Ground Floor Structural Works', durationDays: 30, scheduleOnly: false },
  { name: 'First Floor Structural Works', durationDays: 30, scheduleOnly: false },
  { name: 'Second Floor & Roof Structure', durationDays: 30, scheduleOnly: false },
  { name: 'Blockwork, Plaster & MEP First Fix', durationDays: 30, scheduleOnly: false },
  { name: 'Finishing Works', durationDays: 30, scheduleOnly: false },
  { name: 'External Works, Testing & Handover', durationDays: 30, scheduleOnly: false },
];
