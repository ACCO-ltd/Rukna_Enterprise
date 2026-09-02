import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { DistrictSelect } from './district-select';

const districts = [
  { id: 'd-wbr', organizationId: 'org-1', code: 'WBR', name: 'Waaberi', active: true },
  { id: 'd-hdn', organizationId: 'org-1', code: 'HDN', name: 'Hodan', active: true },
];

const createMutate = vi.fn();
let listed = districts;

vi.mock('../hooks/use-districts', () => ({
  useDistricts: () => ({ data: listed, isPending: false }),
  useCreateDistrict: () => ({
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
  listed = districts;
  permitted = true;
});

describe('DistrictSelect', () => {
  it('filters the list by name or code', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DistrictSelect id="district" value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));
    expect(await screen.findByRole('option', { name: /waaberi/i })).toBeInTheDocument();

    // The code is matched as well as the name — someone who knows the coding scheme should not
    // have to remember the spelling of the district.
    await user.type(screen.getByPlaceholderText('Search'), 'hdn');
    expect(screen.queryByRole('option', { name: /waaberi/i })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /hodan/i })).toBeInTheDocument();
  });

  it('selects a district and closes the panel', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<DistrictSelect id="district" value="" onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: /hodan/i }));

    expect(onChange).toHaveBeenCalledWith('d-hdn');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('creates a district from the last row and selects it immediately', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // The whole point of creating from the picker: the user must not have to answer the same
    // question twice, so a successful create resolves the field it interrupted.
    createMutate.mockImplementation((_payload, options) =>
      options.onSuccess({ id: 'd-new', organizationId: 'org-1', code: 'KRN', name: 'Kaaraan', active: true }),
    );

    renderWithProviders(<DistrictSelect id="district" value="" onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: /add a district/i }));

    // The user types only the name; the code is derived and merely confirmed.
    await user.type(screen.getByLabelText(/name/i), 'Kaaraan');
    expect(screen.getByLabelText(/code/i)).toHaveValue('KRN');

    await user.click(screen.getByRole('button', { name: /add district/i }));
    expect(createMutate).toHaveBeenCalledWith(
      { code: 'KRN', name: 'Kaaraan' },
      expect.anything(),
    );
    expect(onChange).toHaveBeenCalledWith('d-new');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('lets the suggested code be overridden, and stops tracking the name once it is', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DistrictSelect id="district" value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: /add a district/i }));

    await user.type(screen.getByLabelText(/name/i), 'Kaaraan');
    await user.clear(screen.getByLabelText(/code/i));
    await user.type(screen.getByLabelText(/code/i), 'krx');
    expect(screen.getByLabelText(/code/i)).toHaveValue('KRX');

    // A later edit to the name must not overwrite a code the user chose.
    await user.type(screen.getByLabelText(/name/i), ' North');
    expect(screen.getByLabelText(/code/i)).toHaveValue('KRX');
  });

  it('refuses a code the registry already holds', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DistrictSelect id="district" value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: /add a district/i }));

    await user.type(screen.getByLabelText(/name/i), 'Somewhere');
    await user.clear(screen.getByLabelText(/code/i));
    await user.type(screen.getByLabelText(/code/i), 'WBR');

    expect(await screen.findByText(/already belongs to another district/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add district/i })).toBeDisabled();
  });

  it('offers no create row to someone who cannot manage the registry, and says who can', async () => {
    const user = userEvent.setup();
    permitted = false;
    listed = [];

    renderWithProviders(<DistrictSelect id="district" value="" onChange={vi.fn()} />);
    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByRole('option', { name: /add a district/i })).not.toBeInTheDocument();
    expect(await screen.findByText(/an administrator can add them/i)).toBeInTheDocument();
  });
});
