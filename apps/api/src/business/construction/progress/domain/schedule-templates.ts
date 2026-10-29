/**
 * Master Schedule P1-d (ADR-029): the schedule templates the guided setup wizard can apply. A
 * template is an ordered list of phases (work-package name + suggested duration + whether the phase
 * is non-measurable). STANDARD_BUILDING is company-editable (Step 1b, ADR-047): the apply flow asks
 * CompanyTemplatesService for the company's copy and falls back to the Rukna default kept here.
 *
 * Weights are DELIBERATELY not here: they are derived from the BOQ value assigned to each phase
 * (see `suggest-weights`), not guessed at template time. Planned dates are also left to the wizard.
 */

import type { ScheduleTemplateKey } from '@erp/types';

import { DEFAULT_BUILDING_PHASES } from '../../company-templates/domain/default-templates.js';

/** One phase in a schedule template → one work package when applied. */
export interface ScheduleTemplatePhase {
  /** The work-package name (the phase label the user sees). */
  name: string;
  /** Suggested duration in days; the wizard sequences the planned dates from these. */
  durationDays: number;
  /** A non-measurable phase (Design, Mobilization): no BOQ scope, tracked by dates only (§8.5). */
  scheduleOnly: boolean;
}

/** The Rukna default building schedule (the company may override it — see CompanyTemplatesService). */
export const STANDARD_BUILDING_PHASES: readonly ScheduleTemplatePhase[] = DEFAULT_BUILDING_PHASES;

/** The registry of schedule templates, keyed by the wire `ScheduleTemplateKey`. */
export const SCHEDULE_TEMPLATES: Record<ScheduleTemplateKey, readonly ScheduleTemplatePhase[]> = {
  STANDARD_BUILDING: STANDARD_BUILDING_PHASES,
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
