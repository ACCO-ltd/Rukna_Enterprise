import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { PurchaseOrderLine } from '../types';
import {
  GrnLineEditor,
  SELECTABLE_QUALITY,
  grnLineError,
  grnLinesFromPo,
  submittableGrnLines,
  type GrnLineDraft,
} from './grn-line-editor';

/**
 * This editor works around P6 — `@IsPositive()` on `receivedQuantity` and
 * `acceptedQuantity` — and the workaround is invisible in the markup: it is which rows
 * get *omitted* from the payload. If a refactor starts sending zero rows again, every
 * partial delivery `400`s with a message naming a line the user never touched.
 *
 * So `submittableGrnLines` is tested harder than anything else here.
 */

const PO_LINES: PurchaseOrderLine[] = [
  {
    id: 'pol-1',
    lineNumber: 1,
    lineType: 'MATERIAL',
    description: '12mm deformed rebar',
    orderedQuantity: '25',
    unitPrice: '850.00',
    extendedAmount: '21250.00',
    materialId: 'mat-1',
    spendCategoryId: null,
    material: { code: 'REBAR-12MM', name: '12mm Deformed Steel Rebar' },
    uom: { code: 'TON', symbol: 't' },
    spendCategory: null,
  },
  {
    id: 'pol-2',
    lineNumber: 2,
    lineType: 'MATERIAL',
    description: '16mm deformed rebar',
    orderedQuantity: '10',
    unitPrice: '860.00',
    extendedAmount: '8600.00',
    materialId: 'mat-2',
    spendCategoryId: null,
    material: { code: 'REBAR-16MM', name: '16mm Deformed Steel Rebar' },
    uom: { code: 'TON', symbol: 't' },
    spendCategory: null,
  },
];

function setup(lines: GrnLineDraft[], showErrors = false) {
  const onChange = vi.fn();
  renderWithProviders(
    <GrnLineEditor lines={lines} onChange={onChange} showErrors={showErrors} />,
  );
  return { onChange };
}

describe('grnLinesFromPo', () => {
  it('creates one empty row per PO line, as §12.7 specifies', () => {
    const lines = grnLinesFromPo(PO_LINES);

    expect(lines).toHaveLength(2);
    expect(lines[0]!.purchaseOrderLineId).toBe('pol-1');
    expect(lines[0]!.orderedQuantity).toBe('25');
    expect(lines[0]!.received).toBe('');
  });

  it('carries previously-received quantities through when known', () => {
    const lines = grnLinesFromPo(PO_LINES, { 'pol-1': '20' });
    expect(lines[0]!.previouslyReceived).toBe('20');
    expect(lines[1]!.previouslyReceived).toBe('0');
  });
});

describe('submittableGrnLines — the P6 workaround', () => {
  it('omits untouched rows so a partial delivery does not 400 the whole request', () => {
    const lines = grnLinesFromPo(PO_LINES);
    lines[0] = { ...lines[0]!, received: '24', accepted: '24' };

    const submittable = submittableGrnLines(lines);

    expect(submittable).toHaveLength(1);
    expect(submittable[0]!.purchaseOrderLineId).toBe('pol-1');
  });

  it('keeps every row when the whole order is delivered', () => {
    const lines = grnLinesFromPo(PO_LINES).map((l) => ({
      ...l,
      received: '5',
      accepted: '5',
    }));

    expect(submittableGrnLines(lines)).toHaveLength(2);
  });

  it('omits everything when nothing was entered', () => {
    expect(submittableGrnLines(grnLinesFromPo(PO_LINES))).toHaveLength(0);
  });

  it('does not treat a rejection-only entry as untouched', () => {
    const lines = grnLinesFromPo(PO_LINES);
    lines[0] = { ...lines[0]!, received: '5', accepted: '4', rejected: '1' };

    expect(submittableGrnLines(lines)).toHaveLength(1);
  });
});

describe('grnLineError', () => {
  it('does not fault an untouched row', () => {
    expect(grnLineError(grnLinesFromPo(PO_LINES)[0]!)).toBeNull();
  });

  it('accepts a clean partial rejection', () => {
    const line: GrnLineDraft = {
      ...grnLinesFromPo(PO_LINES)[0]!,
      received: '24',
      accepted: '23',
      rejected: '1',
    };
    expect(grnLineError(line)).toBeNull();
  });

  it('faults a split that does not add up', () => {
    const line: GrnLineDraft = {
      ...grnLinesFromPo(PO_LINES)[0]!,
      received: '24',
      accepted: '23',
      rejected: '2',
    };
    expect(grnLineError(line)).toBe('splitMustEqualReceived');
  });

  /** P6 — the API refuses acceptedQuantity: 0, so a wholly rejected line cannot be sent. */
  it('faults a wholly rejected line with the accepted rule, not the split rule', () => {
    const line: GrnLineDraft = {
      ...grnLinesFromPo(PO_LINES)[0]!,
      received: '5',
      accepted: '0',
      rejected: '5',
    };
    expect(grnLineError(line)).toBe('acceptedMustBePositive');
  });
});

describe('GrnLineEditor — rendering', () => {
  it('mirrors received into accepted, which is the common case', async () => {
    const user = userEvent.setup();
    const lines = grnLinesFromPo(PO_LINES);
    const { onChange } = setup(lines);

    await user.type(screen.getAllByLabelText('Received')[0]!, '24');

    const emitted = onChange.mock.calls.at(-1)![0] as GrnLineDraft[];
    expect(emitted[0]!.accepted).toBe(emitted[0]!.received);
  });

  /** P6 — offering REJECTED would guarantee a 400, since it needs accepted = 0. */
  it('does not offer REJECTED as a quality status', () => {
    setup(grnLinesFromPo(PO_LINES));

    expect(SELECTABLE_QUALITY).not.toContain('REJECTED');
    expect(screen.queryByRole('option', { name: 'Rejected' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: 'Partially accepted' }).length).toBeGreaterThan(0);
  });

  it('warns about over-receipt without quoting a tolerance it cannot know (P9)', () => {
    const lines = grnLinesFromPo(PO_LINES);
    // 25 ordered, 27 delivered — 8%, above the 5% fallback.
    lines[0] = { ...lines[0]!, received: '27', accepted: '27' };
    setup(lines);

    const warning = screen.getByText(/exceeds the ordered quantity|above the ordered quantity/i);
    expect(warning).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b5%/);
  });

  it('does not warn when the delivery is within the order', () => {
    const lines = grnLinesFromPo(PO_LINES);
    lines[0] = { ...lines[0]!, received: '24', accepted: '24' };
    setup(lines);

    expect(
      screen.queryByText(/exceeds the ordered quantity|above the ordered quantity/i),
    ).not.toBeInTheDocument();
  });

  it('shows the split readout once a row is touched', () => {
    const lines = grnLinesFromPo(PO_LINES);
    lines[0] = { ...lines[0]!, received: '24', accepted: '23', rejected: '1' };
    setup(lines);

    expect(screen.getByText(/Received 24 — accepted 23, rejected 1/)).toBeInTheDocument();
  });

  it('surfaces the line error only after submit is attempted', () => {
    const lines = grnLinesFromPo(PO_LINES);
    lines[0] = { ...lines[0]!, received: '24', accepted: '20', rejected: '1' };

    const { unmount } = renderWithProviders(
      <GrnLineEditor lines={lines} onChange={vi.fn()} showErrors={false} />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<GrnLineEditor lines={lines} onChange={vi.fn()} showErrors />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Accepted plus rejected must equal the received quantity.',
    );
  });

});
