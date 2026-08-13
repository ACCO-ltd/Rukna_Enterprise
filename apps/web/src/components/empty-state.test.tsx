import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No clients yet" />);
    expect(screen.getByText('No clients yet')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<EmptyState title="No results" description="Try a different search term." />);
    expect(screen.getByText('Try a different search term.')).toBeInTheDocument();
  });

  it('omits description when not provided', () => {
    const { container } = render(<EmptyState title="No results" />);
    // Only the title paragraph — no sibling
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('renders the action when provided', () => {
    render(<EmptyState title="Empty" action={<button>New item</button>} />);
    expect(screen.getByRole('button', { name: 'New item' })).toBeInTheDocument();
  });

  it('renders secondary action when provided', () => {
    render(
      <EmptyState
        title="Empty"
        action={<button>Primary</button>}
        secondaryAction={<button>Secondary</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Secondary' })).toBeInTheDocument();
  });

  it('page variant has a dashed border class', () => {
    const { container } = render(<EmptyState title="Empty" variant="page" />);
    expect(container.firstChild).toHaveClass('border-dashed');
  });

  it('inline variant has no border class', () => {
    const { container } = render(<EmptyState title="Empty" variant="inline" />);
    expect(container.firstChild).not.toHaveClass('border-dashed');
  });

  it('defaults to page variant', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.firstChild).toHaveClass('border-dashed');
  });

  it('renders icon when provided', () => {
    render(<EmptyState title="Empty" icon={<span data-testid="custom-icon" />} />);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });
});
