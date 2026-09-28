import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { chooseOption } from '@/test/choose-option';
import { pickDate } from '@/test/pick-date';

import { RecordSignedContractForm } from './record-signed-contract-form';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const record = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('../hooks/use-record-signed-contract', () => ({
  useRecordSignedContract: () => ({ ...record, isPending: false, error: null }),
}));
vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: () => ({ isPending: false, isError: false, data: [{ id: 'p1', name: 'Hayat Market Renovation', clientId: 'c1' }] }),
}));
vi.mock('@/features/clients/hooks/use-clients', () => ({
  useClients: () => ({ isPending: false, isError: false, data: [{ id: 'c1', name: 'Hayat Market' }] }),
}));
vi.mock('@/features/boq/hooks/use-boq', () => ({
  useBoqWorkspace: () => ({ isPending: false, isError: false, data: { draft: { versionNumber: 1 }, approved: null } }),
}));

beforeEach(() => record.mutate.mockReset());

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await pickDate(user, screen.getByLabelText(/Date signed/), '2026-05-20');
  await user.type(screen.getByLabelText(/Signed contract value/), '412500');
}

describe('RecordSignedContractForm', () => {
  it('starts from the ACCO standard 40/30/20/10 with the advance first, allocating 100%', () => {
    renderWithProviders(<RecordSignedContractForm projectId="p1" />);
    expect(screen.getByDisplayValue('Advance (mobilisation)')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: /Share/ }).map((input) => (input as HTMLInputElement).value)).toEqual(['40', '30', '20', '10']);
    expect(screen.getByText('Allocated').parentElement).toHaveTextContent('Allocated 100%');
    expect(screen.getByDisplayValue('Hayat Market')).toHaveAttribute('readonly');
  });

  it('lists what is wrong on submit instead of disabling the button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RecordSignedContractForm projectId="p1" />);
    await user.click(screen.getByRole('button', { name: 'Record signed contract' }));
    const summary = screen.getByText('Fix these to record the contract').closest('[role="alert"]')!;
    expect(summary).toHaveTextContent('Choose the date the contract was signed');
    expect(summary).toHaveTextContent('Enter the signed value');
    expect(record.mutate).not.toHaveBeenCalled();
  });

  it('holds the schedule to 100% and to a single advance, and asks a Date stage for its date', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RecordSignedContractForm projectId="p1" />);
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Add a stage' }));
    await user.type(document.getElementById('stage-4-percentage')!, '5');
    await chooseOption(user, screen.getByLabelText('Billed on', { selector: '#stage-1-billedOn' }), 'ADVANCE');
    await chooseOption(user, screen.getAllByLabelText('Billed on')[4]!, 'DATE');
    await user.click(screen.getByRole('button', { name: 'Record signed contract' }));
    const summary = screen.getByText('Fix these to record the contract').closest('[role="alert"]')!;
    expect(summary).toHaveTextContent('The stages add up to 105%. They must total 100%.');
    expect(summary).toHaveTextContent('Only one stage can be the advance.');
    expect(summary).toHaveTextContent('Choose the date this stage bills on.');
  });

  it('confirms by naming the value, the BOQ snapshot and the advance, then records with the right triggers', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RecordSignedContractForm projectId="p1" />);
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Record signed contract' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('This records $412,500.00 as the signed value, freezes a signed copy of BOQ version 1 as the scope');
    expect(dialog).toHaveTextContent('The advance of $165,000.00 becomes billable at once.');
    expect(record.mutate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Record contract' }));
    expect(record.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'c1',
        signedDate: '2026-05-20',
        contractValue: '412500',
        paymentTerms: 'Net 30 days',
        paymentPlan: [
          expect.objectContaining({ triggerType: 'ADVANCE', percentage: 0.4 }),
          expect.objectContaining({ triggerType: 'MILESTONE', percentage: 0.3 }),
          expect.objectContaining({ triggerType: 'MILESTONE', percentage: 0.2 }),
          expect.objectContaining({ triggerType: 'MILESTONE', percentage: 0.1 }),
        ],
      }),
      expect.anything(),
    );
  });

  it('shows what gets recorded, live', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RecordSignedContractForm projectId="p1" />);
    const rail = screen.getByRole('complementary', { name: 'What gets recorded' });
    expect(rail).toHaveTextContent('Numbered automatically · Active');
    expect(rail).toHaveTextContent('Copy of BOQ version 1');
    expect(rail).toHaveTextContent('The advance');
    await user.type(screen.getByLabelText(/Signed contract value/), '100');
    expect(rail).toHaveTextContent('$100.00');
  });
});
