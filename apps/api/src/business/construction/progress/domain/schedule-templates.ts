/**
 * Master Schedule P1-d (ADR-029): the server-side schedule templates the guided setup wizard can
 * apply. A template is just an ordered list of phases (work-package names + a suggested duration +
 * whether the phase is non-measurable). Single-tenant for now — ACCO's canonical building sequence;
 * more templates (or an admin-configurable registry) can be added later without touching the apply
 * flow, which reads only from this table.
 *
 * Weights are DELIBERATELY not here: they are derived from the BOQ value assigned to each phase
 * (see `suggest-weights`), not guessed at template time. Planned dates are also left to the wizard;
 * the template carries only the suggested duration so the wizard can sequence dates from the project
 * start.
 *
 * Pure data + a lookup — no Prisma, no I/O — so the apply flow stays testable and the phase list is
 * reviewable in one place.
 */

import type { ScheduleTemplateKey } from '@erp/types';

/** One phase in a schedule template → one work package when applied. */
export interface ScheduleTemplatePhase {
  /** The work-package name (the phase label the user sees). */
  name: string;
  /** Suggested duration in days; the wizard sequences the planned dates from these. */
  durationDays: number;
  /** A non-measurable phase (Design, Mobilization): no BOQ scope, tracked by dates only (§8.5). */
  scheduleOnly: boolean;
}

/**
 * ACCO's standard building schedule (from ACCO's sample programme). Order is significant — it is the
 * phase sequence, and the applied work packages are auto-numbered WP-01…WP-09 in this order. Design
 * and Mobilization are `scheduleOnly` (non-measurable, no BOQ scope); the structural/finishing phases
 * are measurable and take BOQ scope in the wizard's next step.
 */
export const ACCO_STANDARD_BUILDING_PHASES: readonly ScheduleTemplatePhase[] = [
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

/** The registry of schedule templates, keyed by the wire `ScheduleTemplateKey`. */
export const SCHEDULE_TEMPLATES: Record<ScheduleTemplateKey, readonly ScheduleTemplatePhase[]> = {
  ACCO_STANDARD_BUILDING: ACCO_STANDARD_BUILDING_PHASES,
};

/** Look up a template's phases, or `undefined` when the key is unknown. */
export function scheduleTemplatePhases(
  templateKey: string,
): readonly ScheduleTemplatePhase[] | undefined {
  return SCHEDULE_TEMPLATES[templateKey as ScheduleTemplateKey];
}

/**
 * The auto-generated code for the phase at `index` (0-based) — `WP-01`, `WP-02`, … The applied rows
 * are ordered by code (the read model's ordering), so the sequence number IS the phase order.
 */
export function scheduleTemplateCode(index: number): string {
  return `WP-${String(index + 1).padStart(2, '0')}`;
}
