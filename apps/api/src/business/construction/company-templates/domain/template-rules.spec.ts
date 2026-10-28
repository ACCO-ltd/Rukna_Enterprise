import { DEFAULT_BUILDING_PHASES, DEFAULT_PAYMENT_PLAN } from './default-templates.js';
import { normalisePaymentPlan, paymentPlanProblems, scheduleProblems } from './template-rules.js';

const row = (name: string, percentage: string, isAdvance = false) => ({ name, percentage, isAdvance });
const phase = (name: string, durationDays: number, scheduleOnly = false) => ({ name, durationDays, scheduleOnly });

describe('company template rules (Step 1b, ADR-047)', () => {
  it('the Rukna defaults are themselves valid', () => {
    expect(paymentPlanProblems(DEFAULT_PAYMENT_PLAN)).toEqual([]);
    expect(scheduleProblems(DEFAULT_BUILDING_PHASES)).toEqual([]);
  });

  it('payment plan: stages must total exactly 100%', () => {
    expect(paymentPlanProblems([row('A', '50'), row('B', '40')])).toEqual([
      'The stages add up to 90%, not 100%.',
    ]);
    expect(paymentPlanProblems([row('A', '33.33'), row('B', '33.33'), row('C', '33.34')])).toEqual([]);
  });

  it('payment plan: one advance at most, names required, sane percentages', () => {
    const problems = paymentPlanProblems([row('A', '50', true), row(' ', '50.001', true)]);
    expect(problems).toContain('Only one stage can be the advance.');
    expect(problems).toContain('Stage 2 needs a name.');
    expect(problems).toContain('Stage 2 percentage must be above 0 and at most 100, with up to 2 decimals.');
  });

  it('payment plan: empty and non-numeric are rejected', () => {
    expect(paymentPlanProblems([])).toEqual(['The payment plan needs at least one stage.']);
    expect(paymentPlanProblems([row('A', 'abc')])).toContain('Stage 1 percentage is not a number.');
  });

  it('schedule: durations 1–365 whole days, unique names', () => {
    const problems = scheduleProblems([phase('Frame', 0), phase('frame ', 10), phase('Roof', 400), phase('Fit', 2.5)]);
    expect(problems).toEqual([
      'Phase 1 duration must be a whole number of days from 1 to 365.',
      'Phase 2 repeats the name "frame".',
      'Phase 3 duration must be a whole number of days from 1 to 365.',
      'Phase 4 duration must be a whole number of days from 1 to 365.',
    ]);
    expect(scheduleProblems([])).toEqual(['The schedule needs at least one phase.']);
  });

  it('normalise trims names and canonicalises percentages', () => {
    expect(normalisePaymentPlan([row('  Advance ', '40.0', true)])).toEqual([row('Advance', '40', true)]);
  });
});
