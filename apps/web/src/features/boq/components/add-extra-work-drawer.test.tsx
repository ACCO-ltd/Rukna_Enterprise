import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { chooseOption } from '@/test/choose-option';
import { renderWithProviders } from '@/test/render';

import { AddExtraWorkDrawer, type BoqSectionOption } from './add-extra-work-drawer';

const SECTIONS: BoqSectionOption[] = [
  { id: 's1', code: '01', description: 'Substructure' },
  { id: 's2', code: '02', description: 'Superstructure' },
];

function render(overrides: Partial<Parameters<typeof AddExtraWorkDrawer>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <AddExtraWorkDrawer
      open
      currency="USD"
      contractId="contract-1"
      contingencyRemaining="120000.00"
      contractValue="500000.00"
      totalClientRevenue="500000.00"
      absorbEnabled
      variationEnabled
      separateEnabled
      boqSections={SECTIONS}
      isPending={false}
      onSubmit={onSubmit}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onSubmit, onClose };
}

function fillAbsorb(description = 'Steel canopy', amount = '2000') {
  fireEvent.click(screen.getByRole('radio', { name: /Absorb — We cover it internally/i }));
  fireEvent.change(screen.getByLabelText(/What is the work/i), { target: { value: description } });
  fireEvent.change(screen.getByLabelText(/Amount \(USD\)/i), { target: { value: amount } });
}

function fillVariation(description = 'Steel canopy', amount = '2000') {
  // VARIATION is the default route — no need to click the radio.
  fireEvent.change(screen.getByLabelText(/What is the work/i), { target: { value: description } });
  fireEvent.change(screen.getByLabelText(/Amount \(USD\)/i), { target: { value: amount } });
}

describe('AddExtraWorkDrawer', () => {
  // ── Route rendering ──────────────────────────────────────────────────────────

  it('renders all three route options', () => {
    render();
    expect(
      screen.getByRole('radio', { name: /Absorb — We cover it internally/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /Variation — The client pays/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /Separate charge — Bill it one-off/i }),
    ).toBeInTheDocument();
  });

  // ── Consequence previews ─────────────────────────────────────────────────────

  it('shows ABSORB consequence: "Internal cost · Contract unchanged · {amount}"', () => {
    render();
    fireEvent.click(screen.getByRole('radio', { name: /Absorb — We cover it internally/i }));
    fireEvent.change(screen.getByLabelText(/Amount \(USD\)/i), { target: { value: '2000' } });
    expect(document.body.textContent).toContain('Internal cost');
    expect(document.body.textContent).toContain('Contract unchanged');
  });

  it('shows VARIATION consequence: "Contract value: {from} → {to}"', () => {
    render();
    fireEvent.change(screen.getByLabelText(/Amount \(USD\)/i), { target: { value: '2000' } });
    expect(document.body.textContent).toContain('Contract value:');
    expect(document.body.textContent).toContain('502,000');
  });

  it('shows SEPARATE consequence: "Contract unchanged · Separate client charge {amount}"', () => {
    render();
    fireEvent.click(screen.getByRole('radio', { name: /Separate charge — Bill it one-off/i }));
    fireEvent.change(screen.getByLabelText(/Amount \(USD\)/i), { target: { value: '2000' } });
    expect(document.body.textContent).toContain('Separate client charge');
    expect(document.body.textContent).toContain('Contract unchanged');
  });

  // ── Pricing mode ─────────────────────────────────────────────────────────────

  it('defaults to lump-sum: amount field present, no qty/rate fields', () => {
    render();
    expect(screen.getByLabelText(/Amount \(USD\)/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Quantity')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Rate \(USD\)/i)).not.toBeInTheDocument();
  });

  it('switching to Rate × quantity shows qty and rate fields and computes amount live', () => {
    render();
    fireEvent.click(screen.getByRole('radio', { name: /Rate × quantity/i }));

    expect(screen.getByLabelText('Quantity')).toBeInTheDocument();
    expect(screen.getByLabelText(/Rate \(USD\)/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/Rate \(USD\)/i), { target: { value: '500' } });

    expect(document.body.textContent).toContain('2,000');
  });

  // ── BOQ parent section picker ─────────────────────────────────────────────────

  it('shows parent section picker for ABSORB route', () => {
    render();
    fireEvent.click(screen.getByRole('radio', { name: /Absorb — We cover it internally/i }));
    expect(screen.getByLabelText(/BOQ parent section/i)).toBeInTheDocument();
  });

  it('shows parent section picker for SEPARATE route', () => {
    render();
    fireEvent.click(screen.getByRole('radio', { name: /Separate charge — Bill it one-off/i }));
    expect(screen.getByLabelText(/BOQ parent section/i)).toBeInTheDocument();
  });

  it('shows parent section picker for VARIATION route', () => {
    render();
    expect(screen.getByLabelText(/BOQ parent section/i)).toBeInTheDocument();
  });

  it('does not show "Top level" option for VARIATION when sections are available', async () => {
    const user = userEvent.setup();
    render();
    // Open the dropdown to inspect its contents.
    await user.click(screen.getByLabelText(/BOQ parent section/i));
    expect(screen.queryByRole('option', { name: /Top level/i })).not.toBeInTheDocument();
  });

  it('shows "Choose BOQ section" placeholder for VARIATION — no auto-select on mount', async () => {
    const user = userEvent.setup();
    render();
    // Open the dropdown: the placeholder row must be offered so the user can see the state.
    await user.click(screen.getByLabelText(/BOQ parent section/i));
    expect(screen.getByRole('option', { name: /Choose BOQ section/i })).toBeInTheDocument();
  });

  // ── VARIATION-only fields ─────────────────────────────────────────────────────

  it('shows variation title and client ref fields on VARIATION route', () => {
    render();
    expect(screen.getByLabelText(/Variation title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Client approval ref/i)).toBeInTheDocument();
  });

  it('hides variation title and client ref fields on ABSORB route', () => {
    render();
    fireEvent.click(screen.getByRole('radio', { name: /Absorb — We cover it internally/i }));
    expect(screen.queryByLabelText(/Variation title/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Client approval ref/i)).not.toBeInTheDocument();
  });

  // ── Submit guard ──────────────────────────────────────────────────────────────

  it('CTA disabled for VARIATION when sections exist but no section is explicitly selected', () => {
    render();
    fillVariation();
    // The useEffect auto-select was removed: no selection = CTA blocked.
    expect(screen.getByRole('button', { name: /Raise variation/i })).toBeDisabled();
  });

  it('keeps CTA disabled until description, amount, AND a section are all provided (VARIATION)', async () => {
    const user = userEvent.setup();
    render();
    const cta = screen.getByRole('button', { name: /Raise variation/i });
    expect(cta).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/What is the work/i), {
      target: { value: 'Retaining wall' },
    });
    expect(cta).toBeDisabled(); // description alone insufficient

    fireEvent.change(screen.getByLabelText(/Amount \(USD\)/i), { target: { value: '1000' } });
    expect(cta).toBeDisabled(); // description + amount, still no section selected

    await chooseOption(user, screen.getByLabelText(/BOQ parent section/i), 's1');
    expect(cta).not.toBeDisabled();
  });

  // ── Payload correctness ───────────────────────────────────────────────────────

  it('submits the ABSORB payload: no parentId when no section is explicitly selected', () => {
    const { onSubmit } = render();
    fillAbsorb();
    fireEvent.click(screen.getByRole('button', { name: /^Absorb$/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      route: 'ABSORB',
      description: 'Steel canopy',
      amount: '2000.00',
    });
  });

  it('submits the SEPARATE payload: no parentId when no section is explicitly selected', () => {
    const { onSubmit } = render();
    fireEvent.click(screen.getByRole('radio', { name: /Separate charge — Bill it one-off/i }));
    fireEvent.change(screen.getByLabelText(/What is the work/i), { target: { value: 'Steel canopy' } });
    fireEvent.change(screen.getByLabelText(/Amount \(USD\)/i), { target: { value: '4000' } });
    fireEvent.click(screen.getByRole('button', { name: /Add separate charge/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      route: 'SEPARATE',
      description: 'Steel canopy',
      amount: '4000.00',
    });
  });

  it('submits the VARIATION payload with explicitly selected section, variationTitle and clientApprovalReference', async () => {
    const user = userEvent.setup();
    const { onSubmit } = render();
    fillVariation();

    // Deliberate section selection is required for VARIATION when sections exist.
    await chooseOption(user, screen.getByLabelText(/BOQ parent section/i), 's1');

    fireEvent.change(screen.getByLabelText(/Variation title/i), {
      target: { value: 'Steel canopy VO' },
    });
    fireEvent.change(screen.getByLabelText(/Client approval ref/i), {
      target: { value: 'VO-007' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Raise variation/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      route: 'VARIATION',
      description: 'Steel canopy',
      amount: '2000.00',
      parentId: 's1',
      variationTitle: 'Steel canopy VO',
      clientApprovalReference: 'VO-007',
    });
  });

  // ── Route-level prerequisites ─────────────────────────────────────────────────

  it('shows unavailable note on VARIATION when no signed contract exists (variationEnabled=false)', () => {
    render({ variationEnabled: false });
    expect(document.body.textContent).toContain('not available yet');
  });

  it('disables CTA when VARIATION is selected but variationEnabled=false', () => {
    render({ variationEnabled: false });
    fillVariation();
    expect(screen.getByRole('button', { name: /Raise variation/i })).toBeDisabled();
  });
});
