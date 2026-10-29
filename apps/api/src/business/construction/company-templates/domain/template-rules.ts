/**
 * Step 1b (ADR-047): the rules a company's own template must satisfy before it is saved. Pure —
 * each returns the list of problems (empty = valid) so the service can reject with all of them at
 * once and the editor can show them next to the fields.
 */

import { Decimal } from '@prisma/client/runtime/library';
import type { PaymentPlanTemplateRow, ScheduleTemplatePhaseDto } from '@erp/types';

export const PAYMENT_PLAN_MAX_ROWS = 20;
export const SCHEDULE_MAX_PHASES = 30;
export const PHASE_MAX_DAYS = 365;
export const TEMPLATE_NAME_MAX = 120;

export function paymentPlanProblems(rows: readonly PaymentPlanTemplateRow[]): string[] {
  const problems: string[] = [];
  if (rows.length === 0) problems.push('The payment plan needs at least one stage.');
  if (rows.length > PAYMENT_PLAN_MAX_ROWS) {
    problems.push(`The payment plan can have at most ${PAYMENT_PLAN_MAX_ROWS} stages.`);
  }
  if (rows.filter((r) => r.isAdvance).length > 1) {
    problems.push('Only one stage can be the advance.');
  }
  let total = new Decimal(0);
  rows.forEach((row, i) => {
    const label = `Stage ${i + 1}`;
    if (row.name.trim() === '') problems.push(`${label} needs a name.`);
    if (row.name.trim().length > TEMPLATE_NAME_MAX) {
      problems.push(`${label} name is longer than ${TEMPLATE_NAME_MAX} characters.`);
    }
    let pct: Decimal;
    try {
      pct = new Decimal(row.percentage);
    } catch {
      problems.push(`${label} percentage is not a number.`);
      return;
    }
    if (pct.lte(0) || pct.gt(100) || pct.decimalPlaces() > 2) {
      problems.push(`${label} percentage must be above 0 and at most 100, with up to 2 decimals.`);
    }
    total = total.plus(pct);
  });
  if (rows.length > 0 && !total.eq(100)) {
    problems.push(`The stages add up to ${total.toString()}%, not 100%.`);
  }
  return problems;
}

export function scheduleProblems(phases: readonly ScheduleTemplatePhaseDto[]): string[] {
  const problems: string[] = [];
  if (phases.length === 0) problems.push('The schedule needs at least one phase.');
  if (phases.length > SCHEDULE_MAX_PHASES) {
    problems.push(`The schedule can have at most ${SCHEDULE_MAX_PHASES} phases.`);
  }
  const seen = new Set<string>();
  phases.forEach((phase, i) => {
    const label = `Phase ${i + 1}`;
    const name = phase.name.trim();
    if (name === '') problems.push(`${label} needs a name.`);
    if (name.length > TEMPLATE_NAME_MAX) {
      problems.push(`${label} name is longer than ${TEMPLATE_NAME_MAX} characters.`);
    }
    const key = name.toLowerCase();
    if (name !== '' && seen.has(key)) problems.push(`${label} repeats the name "${name}".`);
    seen.add(key);
    if (!Number.isInteger(phase.durationDays) || phase.durationDays < 1 || phase.durationDays > PHASE_MAX_DAYS) {
      problems.push(`${label} duration must be a whole number of days from 1 to ${PHASE_MAX_DAYS}.`);
    }
  });
  return problems;
}

/** Trim names and normalise the percentage string so what is stored is what was validated. */
export function normalisePaymentPlan(rows: readonly PaymentPlanTemplateRow[]): PaymentPlanTemplateRow[] {
  return rows.map((r) => ({
    name: r.name.trim(),
    percentage: new Decimal(r.percentage).toString(),
    isAdvance: r.isAdvance,
  }));
}

export function normaliseSchedule(phases: readonly ScheduleTemplatePhaseDto[]): ScheduleTemplatePhaseDto[] {
  return phases.map((p) => ({ name: p.name.trim(), durationDays: p.durationDays, scheduleOnly: p.scheduleOnly }));
}
