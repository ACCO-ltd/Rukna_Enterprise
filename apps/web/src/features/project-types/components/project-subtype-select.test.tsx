import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectCategory } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import { chooseOption, openSelect } from '@/test/choose-option';

import { ProjectSubtypeSelect } from './project-subtype-select';

const commercialSubtypes = [
  { id: 's-office', organizationId: 'org-1', category: ProjectCategory.COMMERCIAL, name: 'Office buildings', status: 'ACTIVE' as const, createdAt: '', updatedAt: '' },
  { id: 's-retail', organizationId: 'org-1', category: ProjectCategory.COMMERCIAL, name: 'Retail centres', status: 'ACTIVE' as const, createdAt: '', updatedAt: '' },
];

const createMutate = vi.fn();
// The hook is called once per (category, activeOnly). The mock returns rows only for the
// COMMERCIAL category, so a query for another category (or undefined) yields an empty list.
let listedFor: (category: ProjectCategory | undefined) => typeof commercialSubtypes = () => [];

vi.mock('../hooks/use-project-subtypes', () => ({
  useProjectSubtypes: (category: ProjectCategory | undefined) => ({
    data: listedFor(category),
    isPending: false,
  }),
  useCreateProjectSubtype: () => ({
    mutate: createMutate,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

let permitted = true;
vi.mock('@/features/auth/permissions/can', () => ({
  usePermissions: () => ({ can: () => permitted }),
}));

beforeEach(() => {
  createMutate.mockReset();
  permitted = true;
  listedFor = (category) => (category === ProjectCategory.COMMERCIAL ? commercialSubtypes : []);
});

describe('ProjectSubtypeSelect', () => {
  it('is disabled until a category is chosen', () => {
    renderWithProviders(
      <ProjectSubtypeSelect id="subtype" category={undefined} value="" onChange={vi.fn()} />,
    );
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('lists only the chosen category’s active subtypes', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectSubtypeSelect
        id="subtype"
        category={ProjectCategory.COMMERCIAL}
        value=""
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox')).toBeEnabled();
    await openSelect(user, screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: /office buildings/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /retail centres/i })).toBeInTheDocument();
  });

  it('selects a subtype', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <ProjectSubtypeSelect
        id="subtype"
        category={ProjectCategory.COMMERCIAL}
        value=""
        onChange={onChange}
      />,
    );

    await chooseOption(user, screen.getByRole('combobox'), 's-office');

    expect(onChange).toHaveBeenCalledWith('s-office');
  });

  it('opens the add dialog from a button, creates scoped to the current category, and selects it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    createMutate.mockImplementation((_payload, options) =>
      options.onSuccess({
        id: 's-new',
        organizationId: 'org-1',
        category: ProjectCategory.COMMERCIAL,
        name: 'Mixed-use',
        status: 'ACTIVE',
        createdAt: '',
        updatedAt: '',
      }),
    );

    renderWithProviders(
      <ProjectSubtypeSelect
        id="subtype"
        category={ProjectCategory.COMMERCIAL}
        value=""
        onChange={onChange}
      />,
    );

    // The add affordance is the last row of the list now, not a button beside the field.
    await openSelect(user, screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /add a subtype/i }));

    await user.type(screen.getByLabelText(/subtype name/i), 'Mixed-use');
    await user.click(screen.getByRole('button', { name: /^add subtype$/i }));

    // The create payload carries the current category, not free text.
    expect(createMutate).toHaveBeenCalledWith(
      { category: ProjectCategory.COMMERCIAL, name: 'Mixed-use' },
      expect.anything(),
    );
    expect(onChange).toHaveBeenCalledWith('s-new');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('offers no add button to someone who cannot manage the registry, and says who can', () => {
    permitted = false;
    listedFor = () => [];

    renderWithProviders(
      <ProjectSubtypeSelect
        id="subtype"
        category={ProjectCategory.COMMERCIAL}
        value=""
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /add a subtype/i })).not.toBeInTheDocument();
    expect(screen.getByText(/an administrator can add them/i)).toBeInTheDocument();
  });
});
