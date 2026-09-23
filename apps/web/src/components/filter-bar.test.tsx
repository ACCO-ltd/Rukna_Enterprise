import { render, screen } from '@testing-library/react';
import { Button, FilterBar, FilterField, Input } from '@erp/ui';
import { describe, expect, it } from 'vitest';

describe('FilterField', () => {
  it('renders the label and the control', () => {
    render(
      <FilterField id="f-status" label="Status">
        <Input id="f-status" />
      </FilterField>,
    );

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });

  it('visually hides the label while keeping it for assistive technology', () => {
    render(
      <FilterField id="f-search" label="Search" hideLabel>
        <Input id="f-search" />
      </FilterField>,
    );

    expect(screen.getByText('Search')).toHaveClass('sr-only');
    // Still programmatically associated — a screen reader still gets a name.
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
  });
});

describe('FilterBar', () => {
  it('renders every field passed as children', () => {
    render(
      <FilterBar>
        <FilterField id="f-a" label="A">
          <Input id="f-a" />
        </FilterField>
        <FilterField id="f-b" label="B">
          <Input id="f-b" />
        </FilterField>
      </FilterBar>,
    );

    expect(screen.getByLabelText('A')).toBeInTheDocument();
    expect(screen.getByLabelText('B')).toBeInTheDocument();
  });

  it('omits the actions wrapper entirely when none are given', () => {
    const { container } = render(
      <FilterBar>
        <FilterField id="f-a" label="A">
          <Input id="f-a" />
        </FilterField>
      </FilterBar>,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders actions when provided, e.g. a conditional Clear filters button', () => {
    render(
      <FilterBar actions={<Button>Clear filters</Button>}>
        <FilterField id="f-a" label="A">
          <Input id="f-a" />
        </FilterField>
      </FilterBar>,
    );

    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});
