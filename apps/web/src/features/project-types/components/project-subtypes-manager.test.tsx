import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectCategory } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { ProjectSubtypesManager } from './project-subtypes-manager';

const createMutate = vi.fn();
const deactivateMutate = vi.fn();

// Rows per category. Only COMMERCIAL has any; the other five groups render empty.
const rowsByCategory: Partial<Record<ProjectCategory, Array<{ id: string; name: string; status: 'ACTIVE' | 'INACTIVE' }>>> = {
  [ProjectCategory.COMMERCIAL]: [
    { id: 's-office', name: 'Office buildings', status: 'ACTIVE' },
    { id: 's-old', name: 'Legacy kiosks', status: 'INACTIVE' },
  ],
};

vi.mock('../hooks/use-project-subtypes', () => ({
  useProjectSubtypes: (category: ProjectCategory) => ({
    data: (rowsByCategory[category] ?? []).map((r) => ({
      id: r.id,
      organizationId: 'org-1',
      category,
      name: r.name,
      status: r.status,
      createdAt: '',
      updatedAt: '',
    })),
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateProjectSubtype: () => ({ mutate: createMutate, isPending: false, isError: false, error: null }),
  useDeactivateProjectSubtype: () => ({ mutate: deactivateMutate, isPending: false }),
}));

let permitted = true;
vi.mock('@/features/auth/permissions/can', () => ({
  usePermissions: () => ({ can: () => permitted }),
}));

beforeEach(() => {
  createMutate.mockReset();
  deactivateMutate.mockReset();
  permitted = true;
});

function commercialSection() {
  return screen.getByRole('region', { name: /^commercial$/i });
}

describe('ProjectSubtypesManager', () => {
  it('renders one group per fixed category', () => {
    renderWithProviders(<ProjectSubtypesManager />, { permissions: ['manage:project-type'] });
    // Six category headings — every ProjectCategory gets its own group.
    for (const label of [
      'Commercial',
      'Residential',
      'Infrastructure & Civil',
      'Institutional & Public',
      'Industrial',
      'Renovation & Fit-Out',
    ]) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    }
  });

  it('lists a category’s subtypes, including deactivated ones', () => {
    renderWithProviders(<ProjectSubtypesManager />, { permissions: ['manage:project-type'] });
    const section = commercialSection();
    expect(within(section).getByText('Office buildings')).toBeInTheDocument();
    // Inactive rows stay visible (their history is legible), marked Inactive.
    expect(within(section).getByText('Legacy kiosks')).toBeInTheDocument();
    expect(within(section).getByText('Inactive')).toBeInTheDocument();
  });

  it('adds a subtype scoped to its category', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectSubtypesManager />, { permissions: ['manage:project-type'] });

    const section = commercialSection();
    await user.type(within(section).getByLabelText(/subtype name/i), 'Warehouses');
    await user.click(within(section).getByRole('button', { name: /^add$/i }));

    expect(createMutate).toHaveBeenCalledWith(
      { category: ProjectCategory.COMMERCIAL, name: 'Warehouses' },
      expect.anything(),
    );
  });

  it('deactivates an active subtype', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectSubtypesManager />, { permissions: ['manage:project-type'] });

    const section = commercialSection();
    const officeRow = within(section).getByText('Office buildings').closest('tr')!;
    await user.click(within(officeRow).getByRole('button', { name: /deactivate/i }));

    expect(deactivateMutate).toHaveBeenCalledWith('s-office');
  });

  it('hides the add form and actions from someone without manage:project-type', () => {
    permitted = false;
    renderWithProviders(<ProjectSubtypesManager />);

    const section = commercialSection();
    expect(within(section).queryByLabelText(/subtype name/i)).not.toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: /deactivate/i })).not.toBeInTheDocument();
  });
});
