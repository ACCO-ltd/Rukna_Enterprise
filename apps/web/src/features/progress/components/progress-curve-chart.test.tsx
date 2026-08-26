import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProgressActualPoint, ProgressCurvePoint } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { ProgressCurveChart } from './progress-curve-chart';

/**
 * The chart is honest about thin data (1 point ⇒ a dot, not a fabricated line; 0 points ⇒
 * nothing) and gives a screen reader the numbers, not the SVG path. It draws two series.
 */

const baseline: ProgressCurvePoint[] = [
  { periodEndDate: '2026-06-30', plannedPercent: 20 },
  { periodEndDate: '2026-07-31', plannedPercent: 45 },
  { periodEndDate: '2026-08-31', plannedPercent: 70 },
];

const actual: ProgressActualPoint[] = [
  { periodEndDate: '2026-06-30', physicalPercent: 18, verifiedPercent: 15, costPercent: 22 },
  { periodEndDate: '2026-07-31', physicalPercent: 40, verifiedPercent: 36, costPercent: 44 },
  { periodEndDate: '2026-08-31', physicalPercent: 62, verifiedPercent: 58, costPercent: 70 },
];

describe('ProgressCurveChart', () => {
  it('renders two series — a dashed planned line and a solid actual line', () => {
    const { container } = renderWithProviders(
      <ProgressCurveChart baseline={baseline} actual={actual} showVerified />,
    );

    const paths = container.querySelectorAll('path');
    // planned (dashed) + verified + physical = 3 line paths with ≥2 points each.
    expect(paths.length).toBeGreaterThanOrEqual(3);

    const dashed = Array.from(paths).some((p) => p.getAttribute('stroke-dasharray'));
    expect(dashed).toBe(true);

    // The actual physical series is drawn on the chart-1 data-viz colour, never a status token.
    const physical = Array.from(paths).find((p) => p.classList.contains('stroke-chart-1'));
    expect(physical).toBeTruthy();
    expect(container.querySelector('.stroke-success')).toBeNull();
    expect(container.querySelector('.stroke-warning')).toBeNull();
    expect(container.querySelector('.stroke-danger')).toBeNull();
  });

  it('gives assistive tech the latest numbers, not the path', () => {
    renderWithProviders(<ProgressCurveChart baseline={baseline} actual={actual} />);

    const chart = screen.getByRole('img');
    expect(chart).toHaveAccessibleName(/70%/); // latest planned
    expect(chart).toHaveAccessibleName(/62%/); // latest actual physical
  });

  it('draws the point but no physical line when there is a single actual reading', () => {
    const one: ProgressActualPoint[] = [actual[0]];
    const { container } = renderWithProviders(
      <ProgressCurveChart baseline={baseline} actual={one} />,
    );

    // A dot is present…
    expect(container.querySelector('circle.fill-chart-1')).toBeTruthy();
    // …but no line was drawn from a single point (that would imply an unmeasured trend).
    expect(container.querySelector('path.stroke-chart-1')).toBeNull();
  });

  it('renders nothing when there is no data at all', () => {
    const { container } = renderWithProviders(<ProgressCurveChart baseline={[]} actual={[]} />);

    expect(container.querySelector('svg')).toBeNull();
  });
});
