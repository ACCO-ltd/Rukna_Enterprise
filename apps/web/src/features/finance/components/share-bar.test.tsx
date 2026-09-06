import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { Meter, ShareBar, toSegments } from './share-bar';

/**
 * The rules a finance chart has to keep.
 *
 * Three of the five categorical hues sit below 3:1 on the light surface, so identity can never
 * rest on colour: every segment is named and valued. And a sixth generated hue would be
 * indistinguishable from one already on screen, so the tail folds into "Other" rather than the
 * palette growing.
 */
describe('toSegments', () => {
  const data = (...amounts: number[]) =>
    amounts.map((a, i) => ({ key: `k${i}`, label: `Area ${i}`, amount: a.toFixed(2) }));

  it('orders slices largest first and gives each its share', () => {
    const segments = toSegments(data(100, 300, 100), 'Other');
    expect(segments.map((s) => s.amount)).toEqual(['300.00', '100.00', '100.00']);
    expect(segments[0]!.percent).toBe(60);
  });

  /** Never a generated sixth hue — the tail folds. */
  it('folds beyond five slices into Other rather than growing the palette', () => {
    const segments = toSegments(data(10, 9, 8, 7, 6, 5, 4), 'Other');
    expect(segments).toHaveLength(5);
    expect(segments.at(-1)!.label).toBe('Other');
    // 6 + 5 + 4 — nothing is dropped, only grouped.
    expect(segments.at(-1)!.amount).toBe('15.00');
    expect(new Set(segments.map((s) => s.fill)).size).toBe(5);
  });

  /** A stacked bar shows how a positive whole divides; a negative slice has no length. */
  it('drops zero and negative amounts rather than drawing them', () => {
    const segments = toSegments(
      [
        { key: 'a', label: 'A', amount: '100.00' },
        { key: 'b', label: 'B', amount: '0.00' },
        { key: 'c', label: 'C', amount: '-50.00' },
      ],
      'Other',
    );
    expect(segments.map((s) => s.key)).toEqual(['a']);
  });

  it('returns nothing to chart when there is no positive whole', () => {
    expect(toSegments(data(0, 0), 'Other')).toEqual([]);
  });
});

describe('ShareBar', () => {
  const segments = toSegments(
    [
      { key: 'a', label: 'Superstructure', amount: '390000.00' },
      { key: 'b', label: 'Substructure', amount: '280000.00' },
    ],
    'Other',
  );

  it('names and values every segment, so identity never rests on colour', () => {
    renderWithProviders(
      <ShareBar
        title="Budget by cost area"
        segments={segments}
        total="670000.00"
        currency="USD"
        totalLabel="Total budget"
      />,
    );

    expect(screen.getByText('Superstructure')).toBeInTheDocument();
    expect(screen.getByText('Substructure')).toBeInTheDocument();
    expect(screen.getByText(/390,000/)).toBeInTheDocument();
    expect(screen.getByText('58.2%')).toBeInTheDocument();
  });

  it('describes the whole chart to a screen reader', () => {
    renderWithProviders(
      <ShareBar
        title="Budget by cost area"
        segments={segments}
        total="670000.00"
        currency="USD"
        totalLabel="Total budget"
      />,
    );

    expect(
      screen.getByRole('img', { name: /Budget by cost area.*Superstructure 58\.2%/ }),
    ).toBeInTheDocument();
  });

  it('says there is nothing to chart rather than drawing an empty bar', () => {
    renderWithProviders(
      <ShareBar
        title="Budget by cost area"
        segments={[]}
        total="0.00"
        currency="USD"
        totalLabel="Total budget"
      />,
    );
    expect(screen.getByText('Nothing to chart yet.')).toBeInTheDocument();
  });
});

describe('Meter', () => {
  it('states the remainder rather than leaving it to be inferred', () => {
    renderWithProviders(
      <Meter
        title="Revenue consumed by cost"
        limitLabel="Revenue"
        limit="720000.00"
        fillLabel="Total cost"
        fill="510000.00"
        remainderLabel="Net project income"
        remainderNegativeLabel="Net project loss"
        currency="USD"
      />,
    );

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '70.8');
    expect(screen.getByText('Net project income')).toBeInTheDocument();
    expect(screen.getByText(/210,000/)).toBeInTheDocument();
  });

  /** Cost above revenue is a real state; the meter fills and the remainder is named a loss. */
  it('names a loss instead of drawing a negative remainder', () => {
    renderWithProviders(
      <Meter
        title="Revenue consumed by cost"
        limitLabel="Revenue"
        limit="100000.00"
        fillLabel="Total cost"
        fill="140000.00"
        remainderLabel="Net project income"
        remainderNegativeLabel="Net project loss"
        currency="USD"
      />,
    );

    expect(screen.getByText('Net project loss')).toBeInTheDocument();
    // The magnitude, never a negative: the label carries the direction.
    expect(screen.getByText(/^\$?40,000\.00$/)).toBeInTheDocument();
    expect(screen.queryByText(/-40,000/)).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '140');
  });
});
