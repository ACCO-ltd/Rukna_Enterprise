import { render, screen } from '@testing-library/react';
import { RadioGroup } from '@erp/ui';
import { describe, expect, it, vi } from 'vitest';

const OPTIONS = [
  { value: 'direct', label: 'Direct Purchase', description: 'Low-value purchase from an approved supplier.' },
  { value: 'rfq', label: 'Request for Quotation', description: 'Collect quotations from multiple suppliers.' },
  { value: 'tender', label: 'Tender', description: 'Formal process requiring tender evaluation.' },
] as const;

describe('RadioGroup', () => {
  it('renders inline (default) with one radio per option', () => {
    render(
      <RadioGroup label="Procurement method" name="method" value="" onChange={vi.fn()} options={OPTIONS} />,
    );

    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('card variant still renders every option as a radio, checked to match value', () => {
    render(
      <RadioGroup
        label="Procurement method"
        name="method"
        value="rfq"
        onChange={vi.fn()}
        options={OPTIONS}
        variant="card"
      />,
    );

    expect(screen.getByRole('radio', { name: /Request for Quotation/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Direct Purchase/ })).not.toBeChecked();
  });

  it('card variant shows each option description', () => {
    render(
      <RadioGroup
        label="Procurement method"
        name="method"
        value=""
        onChange={vi.fn()}
        options={OPTIONS}
        variant="card"
      />,
    );

    expect(screen.getByText('Formal process requiring tender evaluation.')).toBeInTheDocument();
  });

  it('card variant keeps the description out of the accessible name', () => {
    render(
      <RadioGroup
        label="Procurement method"
        name="method"
        value=""
        onChange={vi.fn()}
        options={OPTIONS}
        variant="card"
      />,
    );

    // If the description were nested inside the <label>, this exact-name query would fail —
    // the accessible name would be "Tender Formal process requiring tender evaluation."
    expect(screen.getByRole('radio', { name: 'Tender' })).toBeInTheDocument();
  });

  it('disables an individual option regardless of variant', () => {
    render(
      <RadioGroup
        label="Payment method"
        name="payment"
        value=""
        onChange={vi.fn()}
        variant="card"
        options={[
          { value: 'bank', label: 'Bank Transfer' },
          { value: 'cheque', label: 'Cheque', disabled: true, description: 'Disabled by company policy.' },
        ]}
      />,
    );

    expect(screen.getByRole('radio', { name: 'Cheque' })).toBeDisabled();
  });
});
