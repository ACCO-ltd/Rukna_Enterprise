import { render, screen } from '@testing-library/react';
import {
  ApprovalChain,
  DefinitionList,
  DefinitionRow,
  LtrValue,
  RecordHeader,
  StatTile,
  type ApprovalStep,
} from '@erp/ui';
import { describe, expect, it } from 'vitest';

/**
 * Bidi isolation on values that are inherently left-to-right.
 *
 * ─── The bug ─────────────────────────────────────────────────────────────────────
 *
 * Caught in browser QA on the Arabic approval chain. A money figure or a date is a
 * mixed-direction run — digits and separators are neutral, a trailing currency code is
 * strongly LTR — so inside an RTL paragraph the bidi algorithm reorders the segments:
 *
 *     4 862 000.00 SOS   rendered as   SOS 000.00 862 4
 *     09 Aug · 09:30     rendered as   Aug · 09:30 09
 *
 * The DOM text was correct both times; the *rendering* was wrong. jsdom does not lay text
 * out, so these tests cannot reproduce the visual defect — what they can do is pin the two
 * attributes whose absence causes it, so nobody removes them believing they are decorative.
 * The visual proof is a browser measurement, recorded in the commit that added this.
 *
 * ─── Why both attributes ─────────────────────────────────────────────────────────
 *
 * `dir="ltr"` fixes the order inside the element. `unicode-bidi: isolate` stops the element
 * from joining the surrounding run, which is what keeps an adjacent label from being dragged
 * to the wrong side. Either alone leaves a case broken.
 */

const isolated = (el: HTMLElement) => ({
  dir: el.getAttribute('dir'),
  isolated: el.className.includes('[unicode-bidi:isolate]'),
});

describe('LtrValue', () => {
  it('sets both dir and the isolation class', () => {
    render(<LtrValue data-testid="v">4 862 000.00 SOS</LtrValue>);
    const el = screen.getByTestId('v');
    expect(isolated(el)).toEqual({ dir: 'ltr', isolated: true });
  });

  it('renders as the requested element, so an identifier can still be a code', () => {
    render(
      <LtrValue as="code" data-testid="v">
        IPC-2026-0042
      </LtrValue>,
    );
    expect(screen.getByTestId('v').tagName).toBe('CODE');
  });
});

describe('DefinitionRow', () => {
  it('isolates a numeric value', () => {
    render(
      <DefinitionList>
        <DefinitionRow label="Balance" numeric>
          486 200.00
        </DefinitionRow>
      </DefinitionList>,
    );
    const dd = screen.getByText('486 200.00');
    expect(isolated(dd)).toEqual({ dir: 'ltr', isolated: true });
  });

  it('leaves a non-numeric value in the page direction', () => {
    // Translated prose must follow the page. Forcing LTR here would render Arabic
    // backwards — the opposite bug, and a worse one.
    render(
      <DefinitionList>
        <DefinitionRow label="Supplier">Horyaal Building Materials</DefinitionRow>
      </DefinitionList>,
    );
    const dd = screen.getByText('Horyaal Building Materials');
    expect(dd.getAttribute('dir')).toBeNull();
    expect(dd.className).not.toContain('unicode-bidi');
  });
});

describe('RecordHeader', () => {
  it('isolates the identifier and the headline figure', () => {
    render(
      <RecordHeader
        identifier="BILL-2026-0311"
        title="Horyaal Building Materials"
        figure={{ label: 'Amount due', value: '486 200.00' }}
      />,
    );
    expect(isolated(screen.getByText('BILL-2026-0311'))).toEqual({ dir: 'ltr', isolated: true });
    expect(isolated(screen.getByText('486 200.00'))).toEqual({ dir: 'ltr', isolated: true });
  });

  it('leaves the title in the page direction', () => {
    render(<RecordHeader title="Horyaal Building Materials" />);
    expect(screen.getByText('Horyaal Building Materials').getAttribute('dir')).toBeNull();
  });
});

describe('ApprovalChain', () => {
  it('isolates a timestamp but not the actor name', () => {
    const steps: ApprovalStep[] = [
      { id: 'a', title: 'Raised', actor: 'Fadumo Ali', at: '09 Aug · 09:30', state: 'approved' },
    ];
    render(<ApprovalChain steps={steps} label="Approval chain" />);

    expect(isolated(screen.getByText('09 Aug · 09:30'))).toEqual({ dir: 'ltr', isolated: true });
    // A person's name is prose and may itself be Arabic.
    expect(screen.getByText('Fadumo Ali').getAttribute('dir')).toBeNull();
  });
});

describe('StatTile', () => {
  it('isolates the value and the delta', () => {
    render(
      <StatTile
        label="Certified to date"
        value="4 862 000.00"
        unit="SOS"
        delta={{ value: '12.4%', direction: 'up', context: 'vs. Jul 2026' }}
      />,
    );
    expect(isolated(screen.getByText(/4 862 000.00/))).toMatchObject({ dir: 'ltr' });
    expect(isolated(screen.getByText('12.4%'))).toMatchObject({ dir: 'ltr' });
  });

  it('leaves the label and the comparison context in the page direction', () => {
    render(
      <StatTile
        label="Certified to date"
        value="1"
        delta={{ value: '1%', direction: 'up', context: 'vs. Jul 2026' }}
      />,
    );
    expect(screen.getByText('Certified to date').getAttribute('dir')).toBeNull();
    expect(screen.getByText('vs. Jul 2026').getAttribute('dir')).toBeNull();
  });
});
