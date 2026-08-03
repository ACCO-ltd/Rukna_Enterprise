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

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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

const messages = {
  common: { currency: { usd: 'US Dollar', sos: 'Somali Shilling', aed: 'UAE Dirham' } },
  platform: {
    projects: {
      create: {
        title: 'New project',
        subtitle: 'A project starts as a draft.',
        codeLabel: 'Project code',
        codeHint: 'Cannot be changed after the project is created.',
        codePlaceholder: 'ACCO-2026-001',
        nameLabel: 'Project name',
        namePlaceholder: 'Al-Baraka Tower Construction',
        nameArLabel: 'Project name (Arabic)',
        descriptionLabel: 'Description',
        clientNameLabel: 'Client',
        contractValueLabel: 'Contract value',
        currencyLabel: 'Currency',
        currencyNone: 'Not set',
        startDateLabel: 'Start date',
        expectedEndDateLabel: 'Expected completion',
        submit: 'Create project',
        submitting: 'Creating...',
        cancel: 'Cancel',
        codeRequired: 'Enter a project code',
        codeTooLong: 'Project code cannot exceed 30 characters',
        nameRequired: 'Enter a project name',
        nameTooLong: 'Project name cannot exceed 255 characters',
        contractValueInvalid: 'Enter a valid amount',
        contractValueNegative: 'Contract value cannot be negative',
        contractValueDecimals: 'Contract value can have at most 2 decimal places',
        endBeforeStart: 'Expected completion cannot be before the start date',
        duplicateCode: 'A project with this code already exists.',
        failed: 'Could not create the project.',
      },
    },
  },
};

function renderForm() {
  return renderWithProviders(<ProjectForm />, { messages });
}

beforeEach(() => {
  push.mockReset();
  vi.mocked(createProject).mockReset();
});

describe('ProjectForm — validation', () => {
  it('does not submit an empty form', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('Enter a project code')).toBeInTheDocument();
    expect(screen.getByText('Enter a project name')).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it('rejects a code longer than the column allows', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('Project code'), 'A'.repeat(31));
    await user.type(screen.getByLabelText('Project name'), 'Tower');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('Project code cannot exceed 30 characters')).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it('rejects a contract value with more than two decimal places', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('Project code'), 'ACCO-1');
    await user.type(screen.getByLabelText('Project name'), 'Tower');
    await user.type(screen.getByLabelText('Contract value'), '100.999');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(
      await screen.findByText('Contract value can have at most 2 decimal places'),
    ).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  // The server does not check this, and a completion date before the start date would
  // quietly misreport the programme.
  it('rejects a completion date before the start date', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('Project code'), 'ACCO-1');
    await user.type(screen.getByLabelText('Project name'), 'Tower');
    await user.type(screen.getByLabelText('Start date'), '2028-03-31');
    await user.type(screen.getByLabelText('Expected completion'), '2026-09-01');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(
      await screen.findByText('Expected completion cannot be before the start date'),
    ).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });
});

describe('ProjectForm — submission', () => {
  it('sends a minimal payload and navigates to the created project', async () => {
    const user = userEvent.setup();
    vi.mocked(createProject).mockResolvedValue({ id: 'p1' } as never);

    renderForm();

    await user.type(screen.getByLabelText('Project code'), 'ACCO-2026-001');
    await user.type(screen.getByLabelText('Project name'), 'Al-Baraka Tower');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith({
        code: 'ACCO-2026-001',
        name: 'Al-Baraka Tower',
      });
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/projects/p1');
    });
  });

  it('includes the optional fields that were filled in', async () => {
    const user = userEvent.setup();
    vi.mocked(createProject).mockResolvedValue({ id: 'p1' } as never);

    renderForm();

    await user.type(screen.getByLabelText('Project code'), 'ACCO-1');
    await user.type(screen.getByLabelText('Project name'), 'Tower');
    await user.type(screen.getByLabelText('Client'), 'Baraka Real Estate');
    await user.type(screen.getByLabelText('Contract value'), '4500000.00');
    await user.selectOptions(screen.getByLabelText('Currency'), 'USD');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith({
        code: 'ACCO-1',
        name: 'Tower',
        clientName: 'Baraka Real Estate',
        contractValue: 4500000,
        currency: 'USD',
      });
    });
  });

  it('explains a duplicate code rather than showing a generic failure', async () => {
    const user = userEvent.setup();
    vi.mocked(createProject).mockRejectedValue(
      new ApiError(409, "Project code 'ACCO-1' already exists", 'CONFLICT'),
    );

    renderForm();

    await user.type(screen.getByLabelText('Project code'), 'ACCO-1');
    await user.type(screen.getByLabelText('Project name'), 'Tower');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(
      await screen.findByText('A project with this code already exists.'),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('lists server validation messages individually', async () => {
    const user = userEvent.setup();
    vi.mocked(createProject).mockRejectedValue(
      new ApiError(400, 'invalid', 'INTERNAL_ERROR', [
        'code must be shorter than or equal to 30 characters',
        'name should not be empty',
      ]),
    );

    renderForm();

    await user.type(screen.getByLabelText('Project code'), 'ACCO-1');
    await user.type(screen.getByLabelText('Project name'), 'Tower');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('name should not be empty')).toBeInTheDocument();
    expect(
      screen.getByText('code must be shorter than or equal to 30 characters'),
    ).toBeInTheDocument();
  });
});
