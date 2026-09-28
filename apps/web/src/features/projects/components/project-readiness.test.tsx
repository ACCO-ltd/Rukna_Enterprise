import { ProjectStatus } from '@erp/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getProjectReadiness } from '@/features/projects/api/projects-api';
import { renderWithProviders } from '@/test/render';
import type { ProjectDetail } from '../types';
import { ProjectReadiness } from './project-readiness';

vi.mock('@/features/projects/api/projects-api', () => ({
  getProjectReadiness: vi.fn(),
}));

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

const project: ProjectDetail = {
  id: 'p1',
  organizationId: 'org-1',
  code: 'ACCO-2026-001',
  name: 'Office tower',
  description: null,
  status: ProjectStatus.DRAFT,
  contractValue: null,
  currency: 'USD',
  clientName: 'Ministry of Works',
  startDate: null,
  expectedEndDate: null,
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  members: [],
  suspensions: [],
};

const ALL = ['manage:project', 'view:boq', 'view:contract', 'manage:project-member'] as const;

function readiness(
  conditions: Array<{
    code: string;
    severity: 'MANDATORY' | 'WAIVABLE';
    satisfied: boolean;
    blockedBy?: string[];
    satisfiedAt?: string | null;
  }>,
) {
  return {
    command: 'start' as const,
    targetStatus: 'ACTIVE',
    ready: conditions.every((c) => c.satisfied),
    conditions: conditions.map((c) => ({
      blockedBy: [],
      satisfiedAt: null,
      ...c,
      detail: '',
    })),
    deferred: [],
    caller: { canRun: false, waivableConditions: [] },
  };
}

beforeEach(() => {
  // Deliberately out of business order: the component owns the reading order.
  vi.mocked(getProjectReadiness).mockResolvedValue(
    readiness([
      { code: 'ACTIVE_MAIN_CONTRACT', severity: 'MANDATORY', satisfied: false },
      { code: 'PROGRAMME_DATES', severity: 'WAIVABLE', satisfied: true },
      { code: 'CLIENT_ACTIVE', severity: 'MANDATORY', satisfied: true },
      { code: 'CONTRACT_START_DATE', severity: 'MANDATORY', satisfied: false },
      { code: 'DELIVERY_TEAM', severity: 'WAIVABLE', satisfied: false },
      { code: 'BOQ_BASELINED', severity: 'MANDATORY', satisfied: true },
    ]),
  );
});

function openRows() {
  return within(screen.getAllByRole('list')[0]!).getAllByRole('listitem');
}

describe('ProjectReadiness — Before you start', () => {
  it('leads with the open steps in business order, each with one action to where the work is', async () => {
    renderWithProviders(<ProjectReadiness project={project} />, { permissions: [...ALL] });

    expect(await screen.findByRole('heading', { name: 'Before you start' })).toBeInTheDocument();
    const rows = openRows();
    expect(rows.map((row) => within(row).getAllByRole('paragraph')[0]?.textContent)).toEqual([
      'Create and execute the main contract',
      'Set the contractual start date',
      'Assign the delivery team',
    ]);
    expect(within(rows[0]!).getByRole('link', { name: 'Open contract' })).toHaveAttribute(
      'href',
      '/projects/p1/commercial/contract-milestones',
    );
    expect(within(rows[2]!).getByRole('link', { name: 'Assign team' })).toHaveAttribute(
      'href',
      '/projects/p1/members?add=1',
    );
  });

  it('says how many required steps are left, and that Start appears once they are done', async () => {
    renderWithProviders(<ProjectReadiness project={project} />, { permissions: [...ALL] });

    expect(await screen.findByText('2 required steps left before you can start.')).toBeInTheDocument();
    expect(
      screen.getByText(/Start project appears once every required step is done\./),
    ).toBeInTheDocument();
  });

  it('reads as ready when only an optional step is open, and says skipping it asks for a reason', async () => {
    vi.mocked(getProjectReadiness).mockResolvedValue(
      readiness([
        { code: 'CLIENT_ACTIVE', severity: 'MANDATORY', satisfied: true },
        { code: 'DELIVERY_TEAM', severity: 'WAIVABLE', satisfied: false },
      ]),
    );
    renderWithProviders(<ProjectReadiness project={project} />, { permissions: [...ALL] });

    expect(
      await screen.findByText('Ready to start. 1 optional step is still open.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Starting with an optional step open asks for a reason\./)).toBeInTheDocument();
  });

  it('reads as ready with nothing open once every step is done', async () => {
    vi.mocked(getProjectReadiness).mockResolvedValue(
      readiness([
        { code: 'CLIENT_ACTIVE', severity: 'MANDATORY', satisfied: true },
        { code: 'DELIVERY_TEAM', severity: 'WAIVABLE', satisfied: true },
      ]),
    );
    renderWithProviders(<ProjectReadiness project={project} />, { permissions: [...ALL] });

    expect(await screen.findByText('Ready to start. Every step is done.')).toBeInTheDocument();
  });

  /**
   * "Exception allowed" was a warning-toned pill. Optional is a property of the step, not a
   * problem with it: a neutral word, and the cost of skipping it said in plain text.
   */
  it('marks a waivable step Optional, with no Complete pill anywhere', async () => {
    renderWithProviders(<ProjectReadiness project={project} />, { permissions: [...ALL] });

    const team = (await screen.findByText('Assign the delivery team')).closest('li')!;
    expect(within(team).getByText('Optional')).toBeInTheDocument();
    expect(within(team).getByText(/Can be skipped with a recorded reason/)).toBeInTheDocument();
    expect(screen.queryByText('Exception allowed')).not.toBeInTheDocument();
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
  });

  it('keeps done steps collapsed until asked, then lists them one line each', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectReadiness project={project} />, { permissions: [...ALL] });

    const toggle = await screen.findByRole('button', { name: /3 steps done/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Assign an active client')).not.toBeVisible();

    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Baseline the BOQ' })).toHaveAttribute(
      'href',
      '/projects/p1/boq',
    );
    // No descriptions on a done row.
    expect(
      screen.queryByText(/Freeze the approved scope/),
    ).not.toBeInTheDocument();
  });

  /**
   * Dependencies come only from the server's `blockedBy`. Since ADR-032 the server does not hold
   * the contract back behind a baselined BOQ (production has had an executed contract with the
   * BOQ step still open), so it sends no such edge — and the client adds none of its own.
   */
  it('does not invent a dependency the server does not enforce', async () => {
    vi.mocked(getProjectReadiness).mockResolvedValue(
      readiness([
        { code: 'BOQ_BASELINED', severity: 'MANDATORY', satisfied: false },
        { code: 'ACTIVE_MAIN_CONTRACT', severity: 'MANDATORY', satisfied: false },
      ]),
    );
    renderWithProviders(<ProjectReadiness project={project} />, { permissions: [...ALL] });

    const rows = await screen.findAllByRole('listitem');
    expect(rows.every((row) => row.getAttribute('data-state') === 'open')).toBe(true);
    expect(screen.queryByText(/Waits for/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open contract' })).toBeInTheDocument();
  });

  it('draws a step as waiting when its server-declared prerequisite is still open', async () => {
    vi.mocked(getProjectReadiness).mockResolvedValue(
      readiness([
        { code: 'ACTIVE_MAIN_CONTRACT', severity: 'MANDATORY', satisfied: false },
        {
          code: 'CONTRACT_START_DATE',
          severity: 'MANDATORY',
          satisfied: false,
          blockedBy: ['ACTIVE_MAIN_CONTRACT'],
        },
      ]),
    );
    renderWithProviders(<ProjectReadiness project={project} />, { permissions: [...ALL] });

    const startDate = (await screen.findByText('Set the contractual start date')).closest('li')!;
    expect(startDate).toHaveAttribute('data-state', 'waiting');
    expect(within(startDate).getByText('Create and execute the main contract')).toBeInTheDocument();
    expect(within(startDate).getByText(/Waits for/)).toBeInTheDocument();
    // Nothing to do on a waiting step: the only action is on its prerequisite.
    expect(within(startDate).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open contract' })).toHaveLength(1);
  });

  it('opens a step whose prerequisite is already done', async () => {
    vi.mocked(getProjectReadiness).mockResolvedValue(
      readiness([
        { code: 'ACTIVE_MAIN_CONTRACT', severity: 'MANDATORY', satisfied: true },
        {
          code: 'CONTRACT_START_DATE',
          severity: 'MANDATORY',
          satisfied: false,
          blockedBy: ['ACTIVE_MAIN_CONTRACT'],
        },
      ]),
    );
    renderWithProviders(<ProjectReadiness project={project} />, { permissions: [...ALL] });

    const startDate = (await screen.findByText('Set the contractual start date')).closest('li')!;
    expect(startDate).toHaveAttribute('data-state', 'open');
    expect(screen.queryByText(/Waits for/)).not.toBeInTheDocument();
  });

  it('shows when a done step was completed, when the server knows', async () => {
    const user = userEvent.setup();
    vi.mocked(getProjectReadiness).mockResolvedValue(
      readiness([
        {
          code: 'BOQ_BASELINED',
          severity: 'MANDATORY',
          satisfied: true,
          satisfiedAt: '2026-09-02T10:00:00.000Z',
        },
        { code: 'CLIENT_ACTIVE', severity: 'MANDATORY', satisfied: true, satisfiedAt: null },
        { code: 'DELIVERY_TEAM', severity: 'WAIVABLE', satisfied: false },
      ]),
    );
    renderWithProviders(<ProjectReadiness project={project} />, { permissions: [...ALL] });

    await user.click(await screen.findByRole('button', { name: /2 steps done/ }));
    const boq = screen.getByRole('link', { name: 'Baseline the BOQ' }).closest('li')!;
    expect(within(boq).getByText('Sep 2, 2026')).toBeInTheDocument();
    // No source, no date — never a guessed one.
    const client = screen.getByText('Assign an active client').closest('li')!;
    expect(within(client).queryByText(/2026/)).not.toBeInTheDocument();
  });

  it('offers no action to a reader who cannot open the place the work is done', async () => {
    renderWithProviders(<ProjectReadiness project={project} />, { permissions: ['view:project'] });

    await screen.findByRole('heading', { name: 'Before you start' });
    for (const row of openRows()) {
      expect(within(row).queryByRole('link')).not.toBeInTheDocument();
    }
    // The owner still says who to ask.
    expect(screen.getAllByText('Commercial team').length).toBeGreaterThan(0);
    // And the footnote does not promise them a Start button.
    expect(screen.queryByText(/Start project appears/)).not.toBeInTheDocument();
  });
});
