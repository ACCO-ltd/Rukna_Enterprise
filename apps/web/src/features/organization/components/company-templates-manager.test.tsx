import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { ApiError } from '@/lib/api-client';

import { CompanyTemplatesManager } from './company-templates-manager';

const savePlan = vi.fn();
const saveSchedule = vi.fn();
const reset = vi.fn();
let planError: unknown = null;
let isDefault = true;

vi.mock('../hooks/use-company-templates', () => ({
  useCompanyTemplates: () => ({
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    data: {
      paymentPlan: {
        isDefault,
        rows: [
          { name: 'Advance', percentage: '40', isAdvance: true },
          { name: 'Handover', percentage: '60', isAdvance: false },
        ],
      },
      schedule: {
        isDefault: true,
        phases: [
          { name: 'Design', durationDays: 7, scheduleOnly: true },
          { name: 'Structure', durationDays: 30, scheduleOnly: false },
        ],
      },
    },
  }),
  useSavePaymentPlanTemplate: () => ({ mutate: savePlan, isPending: false, error: planError, reset: vi.fn() }),
  useSaveScheduleTemplate: () => ({ mutate: saveSchedule, isPending: false, error: null, reset: vi.fn() }),
  useResetCompanyTemplate: () => ({ mutate: reset, isPending: false }),
}));

let permitted = true;
vi.mock('@/features/auth/permissions/can', () => ({
  usePermissions: () => ({ can: () => permitted }),
}));

beforeEach(() => {
  savePlan.mockReset();
  saveSchedule.mockReset();
  reset.mockReset();
  planError = null;
  isDefault = true;
  permitted = true;
});

describe('CompanyTemplatesManager (Step 1b, ADR-047)', () => {
  it('shows both templates, marked as the Rukna default, with a balanced total', () => {
    renderWithProviders(<CompanyTemplatesManager />);
    expect(screen.getByRole('region', { name: 'Payment plan' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Building schedule' })).toBeInTheDocument();
    expect(screen.getAllByText('Rukna default')).toHaveLength(2);
    expect(screen.getByText('Stages total 100%')).toBeInTheDocument();
    expect(screen.getByText('2 phases · 37 days if run one after another')).toBeInTheDocument();
    // Nothing changed yet → nothing to save, and no reset while on the default.
    for (const save of screen.getAllByRole('button', { name: 'Save template' })) expect(save).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Reset to Rukna default' })).not.toBeInTheDocument();
  });

  it('edits a share, flags the total, and saves the edited rows', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompanyTemplatesManager />);
    const share = screen.getByRole('textbox', { name: 'Handover share in percent' });
    await user.clear(share);
    await user.type(share, '50');
    expect(screen.getByText('Stages total 90% — they must total 100%')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Save template' })[0]!);
    expect(savePlan).toHaveBeenCalledWith({
      rows: [
        { name: 'Advance', percentage: '40', isAdvance: true },
        { name: 'Handover', percentage: '50', isAdvance: false },
      ],
    });
  });

  it('keeps a single advance: ticking one stage clears the other', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompanyTemplatesManager />);
    await user.click(screen.getByRole('checkbox', { name: 'Handover is the advance' }));
    expect(screen.getByRole('checkbox', { name: 'Advance is the advance' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Handover is the advance' })).toBeChecked();
  });

  it("lists every problem the server returns", () => {
    planError = new ApiError(400, 'x', 'TEMPLATE_INVALID', [], {
      problems: ['Only one stage can be the advance.', 'The stages add up to 90%, not 100%.'],
    });
    renderWithProviders(<CompanyTemplatesManager />);
    expect(screen.getByText('Only one stage can be the advance.')).toBeInTheDocument();
    expect(screen.getByText('The stages add up to 90%, not 100%.')).toBeInTheDocument();
  });

  it("offers reset on the company's copy and confirms before resetting", async () => {
    isDefault = false;
    const user = userEvent.setup();
    renderWithProviders(<CompanyTemplatesManager />);
    expect(screen.getByText("Your company's copy")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset to Rukna default' }));
    await user.click(screen.getByRole('button', { name: 'Reset template' }));
    expect(reset).toHaveBeenCalledWith('payment-plan');
  });

  it('is read-only without manage:organization', () => {
    permitted = false;
    renderWithProviders(<CompanyTemplatesManager />);
    expect(screen.queryByRole('button', { name: 'Save template' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add stage' })).not.toBeInTheDocument();
  });
});
