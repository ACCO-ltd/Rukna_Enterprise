import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { SetupChecklist, type ChecklistItem } from './setup-checklist';

const ITEMS: ChecklistItem[] = [
  { id: 'boq',      label: 'Bill of Quantities', status: 'complete'   },
  { id: 'contract', label: 'Contract',            status: 'incomplete' },
  { id: 'members',  label: 'Team members',        status: 'blocked',   blockedReason: 'Needs BOQ first' },
  { id: 'notes',    label: 'Notes',               status: 'optional'   },
];

describe('SetupChecklist', () => {
  it('renders all item labels', () => {
    renderWithProviders(<SetupChecklist items={ITEMS} />);
    expect(screen.getByText('Bill of Quantities')).toBeInTheDocument();
    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('Team members')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('shows the section title when provided', () => {
    renderWithProviders(<SetupChecklist items={ITEMS} title="Project setup" />);
    expect(screen.getByText('Project setup')).toBeInTheDocument();
  });

  it('shows the progress string when provided', () => {
    renderWithProviders(<SetupChecklist items={ITEMS} progress="1 of 3 complete" />);
    expect(screen.getByText('1 of 3 complete')).toBeInTheDocument();
  });

  it('exposes a progressbar with correct aria-valuenow', () => {
    renderWithProviders(<SetupChecklist items={ITEMS} title="Setup" progress="x" />);
    // 1 complete out of 3 non-optional items
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
  });

  it('shows percentage badge (33%) for 1-of-3 complete', () => {
    renderWithProviders(<SetupChecklist items={ITEMS} title="Setup" progress="x" />);
    // 1 of 3 (optional excluded) → 33%
    expect(screen.getByText('33%')).toBeInTheDocument();
  });

  it('shows the blocked reason for a blocked item', () => {
    renderWithProviders(<SetupChecklist items={ITEMS} />);
    expect(screen.getByText('Needs BOQ first')).toBeInTheDocument();
  });

  it('renders the action for an incomplete item', () => {
    const items: ChecklistItem[] = [
      {
        id: 'contract',
        label: 'Contract',
        status: 'incomplete',
        action: <button>Go to contract</button>,
      },
    ];
    renderWithProviders(<SetupChecklist items={items} />);
    expect(screen.getByRole('button', { name: 'Go to contract' })).toBeInTheDocument();
  });

  it('does not render the action for a complete item', () => {
    const items: ChecklistItem[] = [
      {
        id: 'done',
        label: 'Done',
        status: 'complete',
        action: <button>Should not show</button>,
      },
    ];
    renderWithProviders(<SetupChecklist items={items} />);
    expect(screen.queryByRole('button', { name: 'Should not show' })).not.toBeInTheDocument();
  });

  it('does not render the action for a blocked item', () => {
    const items: ChecklistItem[] = [
      {
        id: 'blocked',
        label: 'Blocked',
        status: 'blocked',
        action: <button>Should not show</button>,
      },
    ];
    renderWithProviders(<SetupChecklist items={items} />);
    expect(screen.queryByRole('button', { name: 'Should not show' })).not.toBeInTheDocument();
  });
});
