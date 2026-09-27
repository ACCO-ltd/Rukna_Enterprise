import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DocumentActionBar, LifecycleStepper, Notice } from '@erp/ui';

const STEPS = [
  { key: 'DRAFT', label: 'Draft' },
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'POSTED', label: 'Posted' },
];

describe('LifecycleStepper (ADR-035)', () => {
  it('marks the current step, and says where it is in one line for phones', () => {
    render(<LifecycleStepper steps={STEPS} current="APPROVED" />);
    const list = screen.getByRole('list', { name: 'Approved' });
    expect(within(list).getByText('Approved').closest('[aria-current]')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText(/step 3 of 4/)).toBeInTheDocument();
  });

  it('draws a terminal state after the main line as the current one', () => {
    render(<LifecycleStepper steps={STEPS} current="POSTED" terminal={{ label: 'Reversed', tone: 'historical' }} />);
    const list = screen.getByRole('list', { name: 'Reversed' });
    expect(within(list).getByText('Reversed').closest('[aria-current]')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText(/step 5 of 5/)).toBeInTheDocument();
  });

  it('is read-only — nothing in it takes a click', () => {
    render(<LifecycleStepper steps={STEPS} current="DRAFT" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('DocumentActionBar (ADR-035)', () => {
  it('renders no kebab when there are no secondary commands', () => {
    render(<DocumentActionBar primary={<button type="button">Post</button>} />);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument();
  });

  it('puts secondary commands in the kebab and runs them', async () => {
    const user = userEvent.setup();
    const onReverse = vi.fn();
    render(
      <DocumentActionBar
        commands={[{ key: 'reverse', label: 'Reverse', onSelect: onReverse, destructive: true }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reverse' }));
    expect(onReverse).toHaveBeenCalledOnce();
  });
});

describe('Notice (ADR-035)', () => {
  it('announces danger assertively and everything else politely', () => {
    const { rerender } = render(<Notice tone="danger" title="Posting failed" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Posting failed');
    rerender(<Notice tone="historical" title="Posting reversed" />);
    expect(screen.getByRole('status')).toHaveTextContent('Posting reversed');
  });
});
