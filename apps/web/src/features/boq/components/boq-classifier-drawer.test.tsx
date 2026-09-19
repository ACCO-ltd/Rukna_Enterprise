import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { BoqClassifierDrawer } from './boq-classifier-drawer';

function render(overrides: Partial<Parameters<typeof BoqClassifierDrawer>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <BoqClassifierDrawer
      open
      currency="USD"
      contingencyRemaining="120000.00"
      contractValue="2340000.00"
      totalClientRevenue="2340000.00"
      absorbEnabled={false}
      separateEnabled={false}
      sections={[{ id: 'section-01', code: '01', description: 'Preliminaries' }]}
      isPending={false}
      onSubmit={onSubmit}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onSubmit, onClose };
}

function selectVariationSection() {
  fireEvent.change(screen.getByLabelText(/BOQ section/i), {
    target: { value: 'section-01' },
  });
}

describe('BoqClassifierDrawer — decision-first who-pays', () => {
  it('offers all three routes with their consequence previews', () => {
    render();
    expect(screen.getByText(/Absorb/)).toBeInTheDocument();
    expect(screen.getByText(/Variation/)).toBeInTheDocument();
    expect(screen.getByText(/Separate charge/)).toBeInTheDocument();
  });

  it('previews the variation consequence against the live contract value', () => {
    render();
    // Entering an amount projects Contract 2,340,000 → 2,342,000 for the Variation route.
    fireEvent.change(screen.getByLabelText(/What is the work/i), {
      target: { value: 'Steel canopy' },
    });
    fireEvent.change(screen.getByLabelText(/^Amount/i), { target: { value: '2000' } });
    selectVariationSection();
    expect(screen.getAllByText(/2,342,000/).length).toBeGreaterThan(0);
  });

  it('submits the Variation route (adopted inline) with the entered figures', () => {
    const { onSubmit } = render();
    fireEvent.change(screen.getByLabelText(/What is the work/i), {
      target: { value: 'Steel canopy' },
    });
    fireEvent.change(screen.getByLabelText(/^Amount/i), { target: { value: '2000' } });
    // Variation is the default selected route.
    fireEvent.click(screen.getByRole('button', { name: /Raise variation/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      route: 'VARIATION',
      description: 'Steel canopy',
      amount: '2000.00',
      parentId: 'section-01',
    });
  });

  it('passes the optional client approval reference through on the Variation route', () => {
    const { onSubmit } = render();
    fireEvent.change(screen.getByLabelText(/What is the work/i), {
      target: { value: 'Steel canopy' },
    });
    fireEvent.change(screen.getByLabelText(/^Amount/i), { target: { value: '2000' } });
    selectVariationSection();
    fireEvent.change(screen.getByLabelText(/Client approval ref/i), {
      target: { value: 'VO-SIGNED-7' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Raise variation/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      route: 'VARIATION',
      description: 'Steel canopy',
      amount: '2000.00',
      parentId: 'section-01',
      clientApprovalReference: 'VO-SIGNED-7',
    });
  });

  it('shows the client approval ref only for the Variation route', () => {
    render();
    // Variation is the default — the field is present.
    expect(screen.getByLabelText(/Client approval ref/i)).toBeInTheDocument();
    // Switching to Separate hides it (Separate is a one-off client invoice, not a VO).
    fireEvent.click(screen.getByRole('radio', { name: /Separate charge/i }));
    expect(screen.queryByLabelText(/Client approval ref/i)).not.toBeInTheDocument();
  });

  it('keeps the CTA disabled until a description and a positive amount are entered', () => {
    render();
    const cta = screen.getByRole('button', { name: /Raise variation/i });
    expect(cta).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/What is the work/i), {
      target: { value: 'X' },
    });
    // Description alone is not enough — the amount must be positive.
    expect(cta).toBeDisabled();
  });
});
