import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MetricStrip, segmentRules } from './metric-strip';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('MetricStrip', () => {
  it('renders a label and value for each metric', () => {
    render(<MetricStrip metrics={[{ label: 'Active', value: '94' }]} />);

    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('94')).toBeInTheDocument();
  });

  it('links the whole segment when an href is given', () => {
    render(<MetricStrip metrics={[{ label: 'Clients', value: 37, href: '/clients' }]} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/clients');
    // The value lives inside the link — the whole segment is the tap target.
    expect(link).toHaveTextContent('37');
    expect(link).toHaveTextContent('Clients');
  });

  it('renders a plain segment (no link) when href is absent', () => {
    render(<MetricStrip metrics={[{ label: 'Finished', value: 12 }]} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders an em-dash for a null or undefined value, never a blank or zero', () => {
    render(
      <MetricStrip
        metrics={[
          { label: 'Null metric', value: null },
          { label: 'Undefined metric', value: undefined },
        ]}
      />,
    );

    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('puts no border/shadow around any segment (hairlines carry structure, not boxes)', () => {
    const { container } = render(
      <MetricStrip
        metrics={[
          { label: 'A', value: 1 },
          { label: 'B', value: 2, href: '/b' },
        ]}
      />,
    );

    // No segment wrapper or link may carry a full box border or an elevation shadow —
    // that is the "card around everything" anti-pattern this component exists to avoid.
    const boxed = container.querySelectorAll(
      '[class*="border "][class*="rounded"], [class*="shadow-e"], [class*="shadow-panel"]',
    );
    expect(boxed).toHaveLength(0);
  });
});

describe('MetricStrip — rules and tone (ADR-038)', () => {
  it('rules wrapped rows with a top line and never a stray left line', () => {
    // Four segments: 2 per row at base and sm, 4 in one row at lg.
    expect(segmentRules(0, 4)).toContain('border-s-0');
    expect(segmentRules(2, 4)).toMatch(/(^| )border-s-0/); // first of row 2 at base
    expect(segmentRules(2, 4)).toMatch(/(^| )border-t( |$)/);
    expect(segmentRules(2, 4)).toContain('lg:border-s');
    expect(segmentRules(2, 4)).toContain('lg:border-t-0');
  });

  it('colours a value only when a tone is given', () => {
    render(
      <MetricStrip
        metrics={[
          { label: 'Overdue', value: '$10.00', tone: 'warning' },
          { label: 'Collected', value: '$5.00' },
        ]}
      />,
    );
    expect(screen.getByText('$10.00')).toHaveClass('text-warning');
    expect(screen.getByText('$5.00')).toHaveClass('text-foreground');
  });
});
