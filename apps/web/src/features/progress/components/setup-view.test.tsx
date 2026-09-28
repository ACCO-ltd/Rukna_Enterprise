import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  useBoqWorkspace: vi.fn(),
  useBoqLeaves: vi.fn(),
  useProjectRollup: vi.fn(),
  useWorkPackages: vi.fn(),
  useProgrammeBaseline: vi.fn(),
  useMilestones: vi.fn(),
  useProgressSetup: vi.fn(),
}));

vi.mock('@/features/boq/hooks/use-boq', () => ({ useBoqWorkspace: mocks.useBoqWorkspace }));
vi.mock('../hooks/use-boq-leaves', () => ({ useBoqLeaves: mocks.useBoqLeaves }));
vi.mock('../hooks/use-progress', () => ({
  useProjectRollup: mocks.useProjectRollup,
  useWorkPackages: mocks.useWorkPackages,
  useProgrammeBaseline: mocks.useProgrammeBaseline,
}));
vi.mock('../hooks/use-progress-setup', () => ({ useProgressSetup: mocks.useProgressSetup }));
vi.mock('@/features/programme/hooks/use-programme', () => ({ useMilestones: mocks.useMilestones }));

// The step bodies are covered by their own tests; stub them to keep this about the step flow.
vi.mock('./baseline-section', () => ({ BaselineSection: () => <p>baseline editor</p> }));
vi.mock('./work-packages-section', () => ({
  WorkPackageEditor: ({ primary }: { primary: string | null }) => <p>work package editor ({String(primary)})</p>,
  CreateWorkPackageDialog: ({ open }: { open: boolean }) => (open ? <p>create package dialog</p> : null),
}));
vi.mock('./delivery-plan-dialog', () => ({
  DeliveryPlanDialog: ({ open }: { open: boolean }) => (open ? <p>delivery plan review dialog</p> : null),
}));
vi.mock('@/features/programme/components/milestones-section', () => ({
  CreateMilestoneForm: ({ primary }: { primary: boolean }) => <p>milestone form ({String(primary)})</p>,
  VerifyMilestoneDialog: () => null,
}));
vi.mock('@/features/programme/components/work-package-schedule-section', () => ({
  WorkPackageScheduleSection: () => <p>wp schedule</p>,
}));
vi.mock('@/features/programme/components/activities-section', () => ({ ActivitiesSection: () => null }));
vi.mock('@/features/programme/components/schedule-setup-card', () => ({ ScheduleSetupCard: () => null }));
vi.mock('@/features/programme/components/download-master-schedule-button', () => ({
  DownloadMasterScheduleButton: () => null,
}));

import { SetupView } from './setup-view';

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false });

const VERSION = { id: 'v1', versionNumber: 1, baselinedAt: '2026-09-28T09:00:00.000Z' };
const LEAVES = [
  { id: 'l1', code: '1.1', path: ['Substructure'] },
  { id: 'l2', code: '1.2', path: ['Substructure'] },
  { id: 'l3', code: '2.1', path: ['Frame'] },
];

function setup({
  packages = [] as Array<{ id: string; leafCount: number; scheduleOnly?: boolean }>,
  weightsTotal = '0',
  weightsComplete = false,
  allocatedIds = [] as string[],
  baseline = null as unknown,
  milestones = [] as unknown[],
  hasBoq = true,
} = {}) {
  mocks.useBoqWorkspace.mockReturnValue(
    loaded({ approved: hasBoq ? VERSION : null, contractBaseline: null, currency: 'USD', capabilities: { canViewCost: false } }),
  );
  mocks.useBoqLeaves.mockReturnValue({ leaves: hasBoq ? LEAVES : [], isPending: false, hasBaseline: hasBoq });
  mocks.useProjectRollup.mockReturnValue(
    loaded({
      weightsTotal,
      weightsComplete,
      packages: packages.map((p) => ({ scheduleOnly: false, ...p })),
    }),
  );
  mocks.useWorkPackages.mockReturnValue(
    loaded(packages.length ? [{ id: 'wp1', boqNodeIds: allocatedIds }] : []),
  );
  mocks.useProgrammeBaseline.mockReturnValue(loaded(baseline));
  mocks.useMilestones.mockReturnValue(loaded(milestones));
  const measurable = packages.filter((p) => !p.scheduleOnly);
  mocks.useProgressSetup.mockReturnValue({
    isPending: false,
    isError: false,
    gap: undefined,
    facts: {
      hasBoqBaseline: hasBoq,
      packageCount: packages.length,
      allPackagesAllocated: measurable.length > 0 && measurable.every((p) => p.leafCount > 0),
      weightsComplete,
    },
  });
}

beforeEach(() => vi.clearAllMocks());

const PM = { permissions: ['manage:project'], withToast: true };

describe('SetupView', () => {
  it('opens with the intro line and the BOQ as the current step when there is no baseline', () => {
    setup({ hasBoq: false });
    renderWithProviders(<SetupView projectId="p1" />, PM);

    expect(screen.getByText(/Set up how this project's progress is measured/)).toBeInTheDocument();
    const boq = screen.getByRole('region', { name: 'BOQ baselined' });
    expect(boq).toHaveAttribute('aria-current', 'step');
    expect(within(boq).getByRole('link', { name: 'Open BOQ' })).toHaveAttribute('href', '/projects/p1/boq');
    expect(screen.getByText('Waits for a baselined BOQ.')).toBeInTheDocument();
    expect(screen.getAllByText('Waits for work packages.')).toHaveLength(2);
  });

  it('shows the BOQ as one done line and work packages as the current step with the delivery plan primary', async () => {
    const user = userEvent.setup();
    setup();
    renderWithProviders(<SetupView projectId="p1" />, PM);

    expect(screen.getByText(/Version 1 · 3 items in 2 sections · baselined/)).toBeInTheDocument();

    const wp = screen.getByRole('region', { name: 'Work packages' });
    expect(wp).toHaveAttribute('aria-current', 'step');
    expect(within(wp).getByText('Start from the BOQ')).toBeInTheDocument();

    const primary = within(wp).getByRole('button', { name: 'Create delivery plan from BOQ' });
    expect(primary).toHaveClass('bg-brand-ink');
    await user.click(primary);
    expect(screen.getByText('delivery plan review dialog')).toBeInTheDocument();

    await user.click(within(wp).getByRole('button', { name: 'Add a package manually' }));
    expect(screen.getByText('create package dialog')).toBeInTheDocument();
  });

  it('asks for allocation when a package has no BOQ items, with Allocate as the editor primary', () => {
    setup({ packages: [{ id: 'wp1', leafCount: 0 }], weightsTotal: '1', weightsComplete: true });
    renderWithProviders(<SetupView projectId="p1" />, PM);

    expect(screen.getByText(/1 work package has no BOQ items yet/)).toBeInTheDocument();
    expect(screen.getByText('work package editor (allocate)')).toBeInTheDocument();
  });

  it('asks for weights when the server says they do not total 100%', () => {
    setup({ packages: [{ id: 'wp1', leafCount: 3 }], weightsTotal: '0.8', weightsComplete: false, allocatedIds: ['l1'] });
    renderWithProviders(<SetupView projectId="p1" />, PM);

    expect(screen.getByText(/Package weights total 80%/)).toBeInTheDocument();
    expect(screen.getByText('work package editor (weights)')).toBeInTheDocument();
  });

  it('once work packages are done: one summary line, Milestones current, the optional baseline collapsed', () => {
    setup({
      packages: [{ id: 'wp1', leafCount: 3 }],
      weightsTotal: '1',
      weightsComplete: true,
      allocatedIds: ['l1', 'l2', 'l3'],
    });
    renderWithProviders(<SetupView projectId="p1" />, PM);

    expect(screen.getByText('1 package · weights total 100% · all 3 BOQ items allocated')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Milestones' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('milestone form (true)')).toBeInTheDocument();

    const baseline = screen.getByRole('region', { name: /Planned baseline/ });
    expect(within(baseline).getByText('Optional')).toBeInTheDocument();
    expect(screen.queryByText('baseline editor')).not.toBeInTheDocument();
  });

  it('summarises a locked baseline with its dates and rebaseline count', () => {
    setup({
      packages: [{ id: 'wp1', leafCount: 3 }],
      weightsTotal: '1',
      weightsComplete: true,
      allocatedIds: ['l1', 'l2', 'l3'],
      baseline: {
        version: 2,
        approvedAt: '2026-09-28T00:00:00.000Z',
        points: [
          { targetDate: '2026-10-01', cumulativePercent: 0 },
          { targetDate: '2027-03-31', cumulativePercent: 100 },
        ],
      },
      milestones: [
        { id: 'm1', code: 'M1', name: 'Frame complete', status: 'VERIFIED', baselineDate: '2026-12-01', releases: [] },
      ],
    });
    renderWithProviders(<SetupView projectId="p1" />, PM);

    expect(screen.getByText(/Baselined .* · .* → .* · 1 rebaseline$/)).toBeInTheDocument();
    expect(screen.getByText('1 milestone · 1 verified')).toBeInTheDocument();
    // Nothing is current once every step is done.
    for (const region of screen.getAllByRole('region')) expect(region).not.toHaveAttribute('aria-current');
  });

  it('keeps the schedule in one collapsed section below the steps', async () => {
    const user = userEvent.setup();
    setup();
    renderWithProviders(<SetupView projectId="p1" />, PM);

    const toggle = screen.getByRole('button', { name: /Schedule/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('wp schedule')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText('wp schedule')).toBeInTheDocument();
  });
});
