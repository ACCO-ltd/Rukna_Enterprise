import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CellPrimary } from './cell-primary';
import { Meter } from './progress';

describe('Meter', () => {
  it('exposes the value as a meter with its name', () => {
    render(<Meter value={49.4} label="Progress against plan" />);
    const meter = screen.getByRole('meter', { name: 'Progress against plan' });
    expect(meter).toHaveAttribute('aria-valuenow', '49');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps out-of-range values and draws the plan tick only when given', () => {
    const { rerender } = render(<Meter value={140} target={120} label="Plan" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByTestId('meter-target')).toHaveStyle({ insetInlineStart: '100%' });

    rerender(<Meter value={-5} label="Plan" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.queryByTestId('meter-target')).not.toBeInTheDocument();
  });
});

describe('CellPrimary', () => {
  it('links the label and shows the quiet second line', () => {
    render(
      <CellPrimary
        href="/projects/p1"
        label="Hayat Market Renovation"
        sub="ACC-HDN-26-0005 · Hayat Market"
      />,
    );
    expect(screen.getByRole('link', { name: 'Hayat Market Renovation' })).toHaveAttribute(
      'href',
      '/projects/p1',
    );
    expect(screen.getByText('ACC-HDN-26-0005 · Hayat Market')).toBeInTheDocument();
  });

  it('wraps a long label instead of truncating it when asked', () => {
    const { rerender } = render(<CellPrimary href="/x" label="A long project name" />);
    expect(screen.getByRole('link')).toHaveClass('truncate');
    rerender(<CellPrimary href="/x" label="A long project name" wrap />);
    expect(screen.getByRole('link')).toHaveClass('break-words');
    expect(screen.getByRole('link')).not.toHaveClass('truncate');
  });

  it('renders through the given link component', () => {
    render(
      <CellPrimary
        href="/x"
        label="Name"
        renderLink={({ href, className, children }) => (
          <a href={href} className={className} data-router="next">
            {children}
          </a>
        )}
      />,
    );
    expect(screen.getByRole('link')).toHaveAttribute('data-router', 'next');
  });
});
