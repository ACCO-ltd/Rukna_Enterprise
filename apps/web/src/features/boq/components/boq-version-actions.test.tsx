import { BoqVersionStatus } from '@erp/types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { ApiError } from '@/lib/api-client';
import {
  baselineVersion,
  cancelDraftVersion,
  createDraftVersion,
} from '@/features/boq/api/boq-api';

import type { Boq, BoqVersion } from '../types';
import { BoqVersionActions } from './boq-version-actions';

vi.mock('@/features/boq/api/boq-api', () => ({
  baselineVersion: vi.fn(),
  cancelDraftVersion: vi.fn(),
  createDraftVersion: vi.fn(),
  getBoq: vi.fn(),
  getBoqTree: vi.fn(),
  initializeBoq: vi.fn(),
}));

function version(overrides: Partial<BoqVersion> & { id: string }): BoqVersion {
  return {
    boqId: 'b1',
    versionNumber: 1,
    status: BoqVersionStatus.DRAFT,
    notes: null,
    baselinedAt: null,
    baselinedBy: null,
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function boq(overrides: Partial<Boq> = {}): Boq {
  return {
    id: 'b1',
    projectId: 'p1',
    organizationId: 'org-1',
    originalBaselineVersionId: null,
    currentApprovedVersionId: null,
    currentDraftVersionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    versions: [],
    ...overrides,
  };
}

const draft = version({ id: 'v1' });

function renderActions(props: Partial<Parameters<typeof BoqVersionActions>[0]> = {}) {
  return renderWithProviders(
    <BoqVersionActions
      projectId="p1"
      boq={boq({ currentDraftVersionId: 'v1', versions: [draft] })}
      selected={draft}
      isEmpty={false}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.mocked(baselineVersion).mockReset();
  vi.mocked(cancelDraftVersion).mockReset();
  vi.mocked(createDraftVersion).mockReset();
});

describe('BoqVersionActions — what is offered', () => {
  it('offers baseline and discard on the open draft', () => {
    renderActions();

    expect(screen.getByRole('button', { name: 'Baseline this draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start a revision' })).not.toBeInTheDocument();
  });

  it('offers a revision once approved with no draft open', () => {
    renderActions({
      boq: boq({ currentApprovedVersionId: 'v1', versions: [draft] }),
      selected: version({ id: 'v1', status: BoqVersionStatus.BASELINED }),
    });

    expect(screen.getByRole('button', { name: 'Start a revision' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Baseline this draft' })).not.toBeInTheDocument();
  });

  it('renders nothing when no command applies', () => {
    const { container } = renderActions({ boq: boq(), selected: null });

    expect(container).toBeEmptyDOMElement();
  });
});

describe('BoqVersionActions — baselining', () => {
  it('confirms, explaining what baselining commits to', async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole('button', { name: 'Baseline this draft' }));

    expect(baselineVersion).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'The draft becomes the approved Bill of Quantities',
    );
  });

  /**
   * The first baseline also fixes originalBaselineVersionId, which is never overwritten —
   * it is the contract BOQ every later variation is measured against.
   */
  it('warns that a first baseline permanently fixes the contract BOQ', async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole('button', { name: 'Baseline this draft' }));

    expect(screen.getByRole('dialog')).toHaveTextContent(/first baseline/i);
  });

  it('does not repeat that warning on later baselines', async () => {
    const user = userEvent.setup();
    renderActions({
      boq: boq({ currentDraftVersionId: 'v1', originalBaselineVersionId: 'v0', versions: [draft] }),
    });

    await user.click(screen.getByRole('button', { name: 'Baseline this draft' }));

    expect(screen.getByRole('dialog')).not.toHaveTextContent(/first baseline/i);
  });

  // Allowed by the API, almost always a mistake — so it is said, not blocked.
  it('warns when the draft being baselined is empty', async () => {
    const user = userEvent.setup();
    renderActions({ isEmpty: true });

    await user.click(screen.getByRole('button', { name: 'Baseline this draft' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('This draft has no items');
  });

  it('sends the command on confirmation', async () => {
    const user = userEvent.setup();
    vi.mocked(baselineVersion).mockResolvedValue(boq());
    renderActions();

    await user.click(screen.getByRole('button', { name: 'Baseline this draft' }));
    await user.click(screen.getByRole('button', { name: 'Baseline' }));

    await waitFor(() => {
      expect(baselineVersion).toHaveBeenCalledWith('p1', 'v1');
    });
  });
});

describe('BoqVersionActions — discarding a draft', () => {
  it('states that the work is lost and cannot be undone', async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole('button', { name: 'Discard draft' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('cannot be undone');
    expect(cancelDraftVersion).not.toHaveBeenCalled();
  });

  it('abandons the command when dismissed', async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(cancelDraftVersion).not.toHaveBeenCalled();
  });
});

describe('BoqVersionActions — starting a revision', () => {
  const approved = {
    boq: boq({ currentApprovedVersionId: 'v1', versions: [draft] }),
    selected: version({ id: 'v1', status: BoqVersionStatus.BASELINED }),
  };

  it('accepts optional notes and sends them', async () => {
    const user = userEvent.setup();
    vi.mocked(createDraftVersion).mockResolvedValue(boq());
    renderActions(approved);

    await user.click(screen.getByRole('button', { name: 'Start a revision' }));
    await user.type(
      screen.getByLabelText('Notes for this revision'),
      'Variation Order #3 — additional excavation',
    );
    await user.click(screen.getByRole('button', { name: 'Create revision' }));

    await waitFor(() => {
      expect(createDraftVersion).toHaveBeenCalledWith('p1', 'Variation Order #3 — additional excavation');
    });
  });

  // `notes` is @IsOptional server-side, so an empty box must not block the command.
  it('proceeds without notes', async () => {
    const user = userEvent.setup();
    vi.mocked(createDraftVersion).mockResolvedValue(boq());
    renderActions(approved);

    await user.click(screen.getByRole('button', { name: 'Start a revision' }));
    await user.click(screen.getByRole('button', { name: 'Create revision' }));

    await waitFor(() => {
      expect(createDraftVersion).toHaveBeenCalledWith('p1', '');
    });
  });
});

describe('BoqVersionActions — failures', () => {
  it("shows the server's explanation and keeps the dialog open", async () => {
    const user = userEvent.setup();
    vi.mocked(baselineVersion).mockRejectedValue(
      new ApiError(400, 'Only the current draft version can be baselined.', 'BAD_REQUEST', [
        'Only the current draft version can be baselined.',
      ]),
    );
    renderActions();

    await user.click(screen.getByRole('button', { name: 'Baseline this draft' }));
    await user.click(screen.getByRole('button', { name: 'Baseline' }));

    expect(
      await screen.findByText('Only the current draft version can be baselined.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
