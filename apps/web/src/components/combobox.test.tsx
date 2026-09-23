import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox, type ComboboxOption } from '@erp/ui';
import { describe, expect, it, vi } from 'vitest';

const FLAT_OPTIONS: ComboboxOption[] = [
  { value: 'a', label: 'Riverside Commercial Tower' },
  { value: 'b', label: 'Palm Residence' },
];

const GROUPED_OPTIONS: ComboboxOption[] = [
  { value: 'top-1', label: 'Al Noor Building Materials', group: 'Top Matches', meta: '$12,840' },
  { value: 'recent-1', label: 'Al Noor Trading Co.', group: 'Recent Suppliers' },
  { value: 'recent-2', label: 'Al Noor Construction Supplies', group: 'Recent Suppliers' },
];

describe('Combobox', () => {
  it('renders flat options with no group headers when none are grouped', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        id="cb"
        value=""
        onChange={vi.fn()}
        options={FLAT_OPTIONS}
        placeholder="Select a project"
        searchPlaceholder="Search projects"
        emptyLabel="No projects found"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: '' }));

    expect(screen.getByRole('option', { name: 'Riverside Commercial Tower' })).toBeInTheDocument();
    expect(screen.queryByText(/Top Matches/)).not.toBeInTheDocument();
  });

  it('renders a labeled section header per group, with a count', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        id="cb-suppliers"
        value=""
        onChange={vi.fn()}
        options={GROUPED_OPTIONS}
        placeholder="Select a supplier"
        searchPlaceholder="Search suppliers"
        emptyLabel="No suppliers found"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: '' }));

    expect(screen.getByText('Top Matches (1)')).toBeInTheDocument();
    expect(screen.getByText('Recent Suppliers (2)')).toBeInTheDocument();
    // Grouped rows still render as ordinary selectable options.
    expect(screen.getByRole('option', { name: /Al Noor Trading Co\./ })).toBeInTheDocument();
  });

  it('shows the loading row instead of results while loading', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        id="cb-loading"
        value=""
        onChange={vi.fn()}
        options={GROUPED_OPTIONS}
        placeholder="Select a BOQ item"
        searchPlaceholder="Search BOQ items"
        emptyLabel="No items found"
        loading
        loadingLabel="Searching BOQ items…"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: '' }));

    expect(screen.getByText('Searching BOQ items…')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('fires onQueryChange on every keystroke, for a server-driven search', async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    render(
      <Combobox
        id="cb-async"
        value=""
        onChange={vi.fn()}
        options={FLAT_OPTIONS}
        placeholder="Select a project"
        searchPlaceholder="Search projects"
        emptyLabel="No projects found"
        onQueryChange={onQueryChange}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: '' }));
    await user.type(screen.getByPlaceholderText('Search projects'), 'palm');

    expect(onQueryChange).toHaveBeenCalledWith('palm');
  });

  it('moves focus to the filter input as soon as the panel opens', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        id="cb-focus"
        value=""
        onChange={vi.fn()}
        options={FLAT_OPTIONS}
        placeholder="Select a project"
        searchPlaceholder="Search projects"
        emptyLabel="No projects found"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: '' }));

    expect(screen.getByPlaceholderText('Search projects')).toHaveFocus();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        id="cb-escape"
        value=""
        onChange={vi.fn()}
        options={FLAT_OPTIONS}
        placeholder="Select a project"
        searchPlaceholder="Search projects"
        emptyLabel="No projects found"
      />,
    );

    const trigger = screen.getByRole('combobox', { name: '' });
    await user.click(trigger);
    expect(screen.getByPlaceholderText('Search projects')).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByPlaceholderText('Search projects')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('renders an option caption and trailing meta when provided', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        id="cb-rich"
        value=""
        onChange={vi.fn()}
        options={[
          {
            value: 'concrete',
            label: 'Reinforced concrete C30',
            caption: 'Structural Works > Concrete Works',
            meta: '128 m³',
          },
        ]}
        placeholder="Select a BOQ item"
        searchPlaceholder="Search BOQ items"
        emptyLabel="No items found"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: '' }));

    expect(screen.getByText('Structural Works > Concrete Works')).toBeInTheDocument();
    expect(screen.getByText('128 m³')).toBeInTheDocument();
  });
});
