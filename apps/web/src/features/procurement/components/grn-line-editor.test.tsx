import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { PurchaseOrderLine } from '../types';
import {
  GrnLineEditor,
  SELECTABLE_QUALITY,
  grnLineError,
  grnLineQuantities,
  grnLinesFromPo,
  submittableGrnLines,
  type GrnLineDraft,
} from './grn-line-editor';

/**
 * Round 2, acceptance-by-default (D5). Two behaviours carry the design and are tested hardest:
 *
 *  1. A **clean** line (mode 'clean', the default) resolves `accepted = received`, `rejected = 0`
 *     without the user ever seeing an Accepted field — quality accounting is not forced onto a
 *     clean delivery. `grnLineQuantities` owns that rule.
 *  2. The P6 workaround is unchanged: untouched rows are *omitted* from the payload, never sent
 *     as zeros. If a refactor starts sending zero rows again, every partial delivery 400s with a
 *     message naming a line the user never touched — so `submittableGrnLines` is tested hard.
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
    projectId: null,
    boqNodeId: null,
    project: null,
    boqNode: null,
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
    projectId: null,
    boqNodeId: null,
    project: null,
    boqNode: null,
  },
];

function setup(lines: GrnLineDraft[], showErrors = false) {
  const onChange = vi.fn();
  renderWithProviders(
    <GrnLineEditor lines={lines} onChange={onChange} showErrors={showErrors} />,
  );
  return { onChange };
}

/** Convenience for a clean line delivered in full. */
function received(line: GrnLineDraft, qty: string): GrnLineDraft {
  return { ...line, received: qty };
}

describe('grnLinesFromPo', () => {
  it('creates one clean row per PO line, as §12.7 specifies', () => {
    const lines = grnLinesFromPo(PO_LINES);

    expect(lines).toHaveLength(2);
    expect(lines[0]!.purchaseOrderLineId).toBe('pol-1');
    expect(lines[0]!.orderedQuantity).toBe('25');
    expect(lines[0]!.received).toBe('');
    expect(lines[0]!.mode).toBe('clean');
    // D7: material inherited read-only from the PO line.
    expect(lines[0]!.materialCode).toBe('REBAR-12MM');
  });

  it('carries previously-received quantities through when known', () => {
    const lines = grnLinesFromPo(PO_LINES, { 'pol-1': '20' });
    expect(lines[0]!.previouslyReceived).toBe('20');
    expect(lines[1]!.previouslyReceived).toBe('0');
  });
});

describe('grnLineQuantities — acceptance by default (D5)', () => {
  it('mirrors received into accepted with no rejection on a clean line', () => {
    const line = received(grnLinesFromPo(PO_LINES)[0]!, '24');
    const q = grnLineQuantities(line);
    expect(q.acceptedMinor).toBe(q.receivedMinor);
    expect(q.rejectedMinor).toBe(0);
  });

  it('reads the split from the fields once a discrepancy is reported', () => {
    const line: GrnLineDraft = {
      ...grnLinesFromPo(PO_LINES)[0]!,
      received: '24',
      mode: 'discrepancy',
      accepted: '23',
      rejected: '1',
    };
    const q = grnLineQuantities(line);
    expect(q.acceptedMinor).toBeLessThan(q.receivedMinor);
    expect(q.rejectedMinor).toBeGreaterThan(0);
  });
});

describe('submittableGrnLines — the P6 workaround', () => {
  it('omits untouched rows so a partial delivery does not 400 the whole request', () => {
    const lines = grnLinesFromPo(PO_LINES);
    lines[0] = received(lines[0]!, '24');

    const submittable = submittableGrnLines(lines);

    expect(submittable).toHaveLength(1);
    expect(submittable[0]!.purchaseOrderLineId).toBe('pol-1');
  });

  it('keeps every row when the whole order is delivered', () => {
    const lines = grnLinesFromPo(PO_LINES).map((l) => received(l, '5'));
    expect(submittableGrnLines(lines)).toHaveLength(2);
  });

  it('omits everything when nothing was entered', () => {
    expect(submittableGrnLines(grnLinesFromPo(PO_LINES))).toHaveLength(0);
  });

  it('does not treat a rejection-only discrepancy as untouched', () => {
    const lines = grnLinesFromPo(PO_LINES);
    lines[0] = {
      ...lines[0]!,
      received: '5',
      mode: 'discrepancy',
      accepted: '4',
      rejected: '1',
    };

    expect(submittableGrnLines(lines)).toHaveLength(1);
  });
});

describe('grnLineError', () => {
  it('does not fault an untouched row', () => {
    expect(grnLineError(grnLinesFromPo(PO_LINES)[0]!)).toBeNull();
  });

  it('never faults a clean line — accepted mirrors received by construction', () => {
    expect(grnLineError(received(grnLinesFromPo(PO_LINES)[0]!, '24'))).toBeNull();
  });

  it('accepts a clean partial rejection', () => {
    const line: GrnLineDraft = {
      ...grnLinesFromPo(PO_LINES)[0]!,
      received: '24',
      mode: 'discrepancy',
      accepted: '23',
      rejected: '1',
    };
    expect(grnLineError(line)).toBeNull();
  });

  it('faults a split that does not add up', () => {
    const line: GrnLineDraft = {
      ...grnLinesFromPo(PO_LINES)[0]!,
      received: '24',
      mode: 'discrepancy',
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
      mode: 'discrepancy',
      accepted: '0',
      rejected: '5',
    };
    expect(grnLineError(line)).toBe('acceptedMustBePositive');
  });
});

describe('GrnLineEditor — rendering', () => {
  it('shows only the Received now input on a clean line — no Accepted/Rejected fields', () => {
    setup(grnLinesFromPo(PO_LINES));

    expect(screen.getAllByLabelText('Received now').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Accepted')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Rejected')).not.toBeInTheDocument();
  });

  it('reveals the split fields once a line is switched to Report discrepancy', () => {
    const lines = grnLinesFromPo(PO_LINES);
    lines[0] = { ...received(lines[0]!, '24'), mode: 'discrepancy' };
    setup(lines);

    expect(screen.getByLabelText('Accepted')).toBeInTheDocument();
    expect(screen.getByLabelText('Rejected')).toBeInTheDocument();
  });

  it('switches a line to discrepancy mode when the toggle is used', async () => {
    const user = userEvent.setup();
    const { onChange } = setup(grnLinesFromPo(PO_LINES));

    await user.click(screen.getAllByRole('tab', { name: 'Report discrepancy' })[0]!);

    const emitted = onChange.mock.calls.at(-1)![0] as GrnLineDraft[];
    expect(emitted[0]!.mode).toBe('discrepancy');
  });

  /** P6 — offering REJECTED would guarantee a 400, since it needs accepted = 0. */
  it('does not offer REJECTED as a quality status', () => {
    const lines = grnLinesFromPo(PO_LINES);
    lines[0] = { ...received(lines[0]!, '24'), mode: 'discrepancy' };
    setup(lines);

    expect(SELECTABLE_QUALITY).not.toContain('REJECTED');
    expect(screen.queryByRole('option', { name: 'Rejected' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Partially accepted' })).toBeInTheDocument();
  });

  it('flags an over-receipt without quoting a tolerance it cannot know (P9)', () => {
    const lines = grnLinesFromPo(PO_LINES);
    // 25 ordered, 27 delivered — 2 over remaining and 8%, above the 5% fallback.
    lines[0] = received(lines[0]!, '27');
    setup(lines);

    expect(screen.getByText(/exceeds the remaining balance/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b5%/);
  });

  it('does not flag when the delivery is within the remaining balance', () => {
    const lines = grnLinesFromPo(PO_LINES);
    lines[0] = received(lines[0]!, '24');
    setup(lines);

    expect(screen.queryByText(/exceeds the remaining balance/i)).not.toBeInTheDocument();
  });

  it('surfaces the discrepancy split error only after submit is attempted', () => {
    const lines = grnLinesFromPo(PO_LINES);
    lines[0] = {
      ...received(lines[0]!, '24'),
      mode: 'discrepancy',
      accepted: '20',
      rejected: '1',
    };

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
