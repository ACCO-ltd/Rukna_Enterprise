import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { findDayCell, pickDate } from '@/test/pick-date';
import { chooseOption } from '@/test/choose-option';
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

// The subtype picker (and the review-step name lookup) read this hook. Return no subtypes —
// the subtype is optional and no test here exercises picking one; the point is that category
// is required and rides in the payload.
vi.mock('@/features/project-types/hooks/use-project-subtypes', () => ({
  useProjectSubtypes: () => ({ data: [], isPending: false }),
  useCreateProjectSubtype: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useDeactivateProjectSubtype: () => ({ mutate: vi.fn(), isPending: false }),
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

async function fillIdentity(
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
  await chooseOption(user, screen.getByRole('combobox', { name: /^district/i }), 'd-wbr');
  // Category is required (PTD1-PTD5) — pick one so step 1 can advance.
  await chooseOption(user, screen.getByRole('combobox', { name: /^category/i }), 'COMMERCIAL');
  await chooseOption(user, screen.getByRole('combobox', { name: /^client/i }), clientValue);
  if (location) await user.type(screen.getByRole('textbox', { name: /^site address/i }), location);
}

async function fillDetails(
  user: ReturnType<typeof userEvent.setup>,
  {
    startDate,
    endDate,
    description,
  }: { startDate?: string; endDate?: string; description?: string } = {},
) {
  if (startDate) await pickDate(user, screen.getByLabelText('Start date'), startDate);
  if (endDate) await pickDate(user, screen.getByLabelText('Expected completion'), endDate);
  if (description) await user.type(screen.getByLabelText('Description'), description);
}

async function submitProject(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Create project' }));
}

beforeEach(() => {
  push.mockReset();
  vi.mocked(createProject).mockReset();
  mockSearchParams = new URLSearchParams();
});

// ── Validation ────────────────────────────────────────────────────────────────

describe('ProjectForm — validation', () => {
  it('validates required fields when the single form is submitted', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(screen.getAllByText('Enter a project name')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Select a client')[0]).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it('requires a client before creating a project', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByRole('textbox', { name: /^project name/i }), 'Tower');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect((await screen.findAllByText('Select a client'))[0]).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it('requires a category before creating a project (PTD1-PTD5)', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByRole('textbox', { name: /^project name/i }), 'Tower');
    await chooseOption(user, screen.getByRole('combobox', { name: /^district/i }), 'd-wbr');
    await chooseOption(user, screen.getByRole('combobox', { name: /^client/i }), 'client-1');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    // The category field surfaces its required error (a role="alert"); the wizard stays on step 1.
    expect((await screen.findAllByText('Select a category'))[0]).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it('will not offer a completion date before the start date', async () => {
    const user = userEvent.setup();
    renderForm();

    await fillIdentity(user);
    await fillDetails(user, { startDate: '2028-03-31' });

    // The rule used to be caught on submit, by the schema. The completion picker is now floored
    // at the start date, so the wrong value cannot be entered at all — the day before it is
    // disabled, and the calendar does not even offer an earlier year. The schema check stays as
    // the backstop for the edit form and for anything posting to the API directly.
    const cell = await findDayCell(
      user,
      screen.getByLabelText('Expected completion'),
      '2028-03-30',
    );
    expect(cell).toHaveAttribute('data-disabled');
    expect(createProject).not.toHaveBeenCalled();
  });
});

// ── Submission ────────────────────────────────────────────────────────────────

describe('ProjectForm — submission', () => {
  it('sends a minimal payload and navigates to the created project', async () => {
    const user = userEvent.setup();
    vi.mocked(createProject).mockResolvedValue({ id: 'p1' } as never);

    renderForm();

    await fillIdentity(user, { name: 'Al-Baraka Tower' });
    await submitProject(user);

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith({
        name: 'Al-Baraka Tower',
        districtId: 'd-wbr',
        category: 'COMMERCIAL',
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

    await fillIdentity(user, { location: 'Mogadishu' });
    await fillDetails(user, { startDate: '2026-09-01', description: 'Mixed-use tower' });
    await submitProject(user);

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith({
        name: 'Tower',
        districtId: 'd-wbr',
        category: 'COMMERCIAL',
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
      new ApiError(400, 'invalid', 'INTERNAL_ERROR', ['name should not be empty']),
    );

    renderForm();

    await fillIdentity(user);
    await submitProject(user);

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
    expect(screen.queryByRole('button', { name: 'Create project' })).not.toBeInTheDocument();
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
    await chooseOption(user, screen.getByRole('combobox', { name: /^district/i }), 'd-wbr');
    await chooseOption(user, screen.getByRole('combobox', { name: /^category/i }), 'COMMERCIAL');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'client-1' })),
    );
  });
});

describe('Project form client handoff', () => {
  it('retains project details while opening and cancelling client creation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectForm />, { permissions: ['manage:client'], withToast: true });
    await user.type(screen.getByRole('textbox', { name: /^project name/i }), 'Preserved tower');
    await user.click(screen.getByRole('button', { name: 'New client' }));
    expect(screen.getByRole('button', { name: 'Create client' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('textbox', { name: /^project name/i })).toHaveValue('Preserved tower');
    expect(createProject).not.toHaveBeenCalled();
  });
});
