import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { ApiError } from '@/lib/api-client';
import { createProject } from '@/features/projects/api/projects-api';

import { ProjectForm } from './project-form';

vi.mock('@/features/projects/api/projects-api', () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
}));

// Mutable so individual tests can set ?clientId= before rendering.
let mockSearchParams = new URLSearchParams();

vi.mock('@/features/clients/hooks/use-clients', () => ({
  useClients: () => ({
    data: [{ id: 'client-1', name: 'Baraka Real Estate', status: 'ACTIVE' }],
    isPending: false,
  }),
}));

vi.mock('@/features/districts/hooks/use-districts', () => ({
  useDistricts: () => ({
    data: [{ id: 'd-wbr', organizationId: 'org-1', code: 'WBR', name: 'Waaberi', active: true }],
    isPending: false,
  }),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/projects/new',
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

function renderForm() {
  return renderWithProviders(<ProjectForm />);
}

// ── Wizard navigation helpers ──────────────────────────────────────────────────

async function fillStep1(
  user: ReturnType<typeof userEvent.setup>,
  {
    name = 'Tower',
    clientValue = 'client-1',
    location,
  }: { name?: string; clientValue?: string; location?: string } = {},
) {
  // getByLabelText uses raw textContent which includes the aria-hidden asterisk on
  // required fields; getByRole uses the ARIA accessible-name algorithm which excludes it.
  await user.type(screen.getByRole('textbox', { name: /^project name/i }), name);
  await user.selectOptions(screen.getByRole('combobox', { name: /^district/i }), 'd-wbr');
  await user.selectOptions(screen.getByRole('combobox', { name: /^client/i }), clientValue);
  if (location) await user.type(screen.getByLabelText('Location'), location);
}

async function goToStep2(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Next' }));
}

async function fillStep2(
  user: ReturnType<typeof userEvent.setup>,
  {
    startDate,
    endDate,
    description,
  }: { startDate?: string; endDate?: string; description?: string } = {},
) {
  if (startDate) await user.type(screen.getByLabelText('Start date'), startDate);
  if (endDate) await user.type(screen.getByLabelText('Expected completion'), endDate);
  if (description) await user.type(screen.getByLabelText('Description'), description);
}

async function goToStep3(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Review & create' }));
}

async function submitWizard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Create project' }));
}

beforeEach(() => {
  push.mockReset();
  vi.mocked(createProject).mockReset();
  mockSearchParams = new URLSearchParams();
});

// ── Validation ────────────────────────────────────────────────────────────────

describe('ProjectForm — validation', () => {
  it('validates step 1 fields when Next is clicked on an empty form', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Enter a project name')).toBeInTheDocument();
    expect(screen.getByText('Select a client')).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it('requires a client before advancing from step 1', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByRole('textbox', { name: /^project name/i }), 'Tower');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Select a client')).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it('rejects a completion date before the start date', async () => {
    const user = userEvent.setup();
    renderForm();

    await fillStep1(user);
    await goToStep2(user);

    await fillStep2(user, { startDate: '2028-03-31', endDate: '2026-09-01' });
    await goToStep3(user);

    expect(
      await screen.findByText('Expected completion cannot be before the start date'),
    ).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });
});

// ── Submission ────────────────────────────────────────────────────────────────

describe('ProjectForm — submission', () => {
  it('sends a minimal payload and navigates to the created project', async () => {
    const user = userEvent.setup();
    vi.mocked(createProject).mockResolvedValue({ id: 'p1' } as never);

    renderForm();

    await fillStep1(user, { name: 'Al-Baraka Tower' });
    await goToStep2(user);
    await goToStep3(user);
    await submitWizard(user);

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith({
        name: 'Al-Baraka Tower',
        districtId: 'd-wbr',
        commercialModel: 'CLIENT_CONTRACT',
        participationModel: 'SOLE',
        clientId: 'client-1',
      });
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/projects/p1?created=1');
    });
  });

  it('includes the optional fields that were filled in', async () => {
    const user = userEvent.setup();
    vi.mocked(createProject).mockResolvedValue({ id: 'p1' } as never);

    renderForm();

    await fillStep1(user, { location: 'Mogadishu' });
    await goToStep2(user);
    await fillStep2(user, { startDate: '2026-09-01', description: 'Mixed-use tower' });
    await goToStep3(user);
    await submitWizard(user);

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith({
        name: 'Tower',
        districtId: 'd-wbr',
        commercialModel: 'CLIENT_CONTRACT',
        participationModel: 'SOLE',
        clientId: 'client-1',
        description: 'Mixed-use tower',
        location: 'Mogadishu',
        startDate: '2026-09-01',
      });
    });
  });

  it('lists server validation messages individually', async () => {
    const user = userEvent.setup();
    vi.mocked(createProject).mockRejectedValue(
      new ApiError(400, 'invalid', 'INTERNAL_ERROR', [
        'name should not be empty',
      ]),
    );

    renderForm();

    await fillStep1(user);
    await goToStep2(user);
    await goToStep3(user);
    await submitWizard(user);

    expect(await screen.findByText('name should not be empty')).toBeInTheDocument();
  });
});

// ── Client preselection ────────────────────────────────────────────────────────

describe('ProjectForm — client preselection', () => {
  it('shows an error when the clientId param references an unknown client', async () => {
    mockSearchParams = new URLSearchParams({ clientId: 'unknown-xyz' });
    renderForm();

    // The wizard should not render at all — just the error alert.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The client in the URL was not found. It may have been deactivated or does not exist.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('preselects and locks the client when a valid clientId param is provided', async () => {
    const user = userEvent.setup();
    vi.mocked(createProject).mockResolvedValue({ id: 'p1' } as never);
    mockSearchParams = new URLSearchParams({ clientId: 'client-1' });

    renderForm();

    // The client field should be a locked read-only input, not a select.
    const clientInput = await screen.findByDisplayValue('Baraka Real Estate');
    expect(clientInput).toHaveAttribute('readonly');

    // User can advance without selecting a client from a dropdown.
    await user.type(screen.getByRole('textbox', { name: /^project name/i }), 'Tower');
    await user.selectOptions(screen.getByRole('combobox', { name: /^district/i }), 'd-wbr');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Step 2 should be shown.
    expect(screen.getByLabelText('Start date')).toBeInTheDocument();
  });
});
