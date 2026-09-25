import { ProjectStatus } from '@erp/types';
import { screen, within } from '@testing-library/react';
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

beforeEach(() => {
  vi.mocked(getProjectReadiness).mockResolvedValue({
    command: 'start',
    targetStatus: 'ACTIVE',
    ready: false,
    conditions: [
      { code: 'ACTIVE_MAIN_CONTRACT', severity: 'MANDATORY', satisfied: false, detail: '' },
      { code: 'PROGRAMME_DATES', severity: 'WAIVABLE', satisfied: false, detail: '' },
      { code: 'CLIENT_ACTIVE', severity: 'MANDATORY', satisfied: true, detail: '' },
      { code: 'CONTRACT_START_DATE', severity: 'MANDATORY', satisfied: false, detail: '' },
      { code: 'DELIVERY_TEAM', severity: 'WAIVABLE', satisfied: false, detail: '' },
      { code: 'BOQ_BASELINED', severity: 'MANDATORY', satisfied: false, detail: '' },
    ],
    deferred: [],
  });
});

describe('ProjectReadiness preparation sequence', () => {
  it('orders server conditions by business dependency and blocks the contract behind the BOQ', async () => {
    renderWithProviders(<ProjectReadiness project={project} />, {
      permissions: ['manage:project', 'view:boq', 'view:contract', 'manage:project-member'],
    });

    const list = await screen.findByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getAllByRole('paragraph')[0]?.textContent)).toEqual([
      'Assign an active client',
      'Baseline the BOQ',
      'Create and execute the main contract',
      'Set the contractual start date',
      'Assign the delivery team',
      'Set planned project dates',
    ]);

    const contractRow = rows[2]!;
    expect(within(contractRow).getByText('Blocked')).toBeInTheDocument();
    expect(within(contractRow).getByText('Complete "Baseline the BOQ" first.')).toBeInTheDocument();
    expect(within(contractRow).queryByRole('link', { name: 'Open task' })).not.toBeInTheDocument();
    expect(within(rows[1]!).getByRole('link', { name: 'Open task' })).toHaveAttribute(
      'href',
      '/projects/p1/boq',
    );
  });

  it('keeps completed steps visible and unlocks contract work after the BOQ is baselined', async () => {
    vi.mocked(getProjectReadiness).mockResolvedValue({
      command: 'start',
      targetStatus: 'ACTIVE',
      ready: false,
      conditions: [
        { code: 'CLIENT_ACTIVE', severity: 'MANDATORY', satisfied: true, detail: '' },
        { code: 'BOQ_BASELINED', severity: 'MANDATORY', satisfied: true, detail: '' },
        { code: 'ACTIVE_MAIN_CONTRACT', severity: 'MANDATORY', satisfied: false, detail: '' },
        { code: 'CONTRACT_START_DATE', severity: 'MANDATORY', satisfied: false, detail: '' },
      ],
      deferred: [],
    });

    renderWithProviders(<ProjectReadiness project={project} />, {
      permissions: ['view:contract'],
    });

    expect(await screen.findByText('2 of 4 complete')).toBeInTheDocument();
    expect(screen.getAllByText('Complete')).toHaveLength(2);
    expect(
      screen.getByRole('link', { name: 'Open task' }),
    ).toHaveAttribute('href', '/projects/p1/commercial/contract-security');
  });
});
