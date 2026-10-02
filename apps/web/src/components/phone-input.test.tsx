import { useState } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { EMPTY_PHONE, toE164, type PhoneValue } from '@/lib/phone';
import { renderWithProviders } from '@/test/render';

import { PhoneInput } from './phone-input';

function Harness() {
  const [value, setValue] = useState<PhoneValue>(EMPTY_PHONE);
  return (
    <>
      <label htmlFor="phone">Phone</label>
      <PhoneInput id="phone" value={value} onChange={setValue} />
      <output aria-label="e164">{toE164(value) ?? 'invalid'}</output>
    </>
  );
}

describe('PhoneInput', () => {
  it('defaults to Somalia +252 and emits E.164 from the national number', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    expect(screen.getByRole('combobox', { name: 'Country code' })).toHaveTextContent('+252');
    await user.type(screen.getByRole('textbox', { name: 'Phone' }), '61 234 5678');
    expect(screen.getByLabelText('e164')).toHaveTextContent('+252612345678');
  });

  it('searches countries by name or dial code and switches the code', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole('combobox', { name: 'Country code' }));
    await user.type(screen.getByPlaceholderText('Search country or code'), '254');
    await user.click(await screen.findByRole('option', { name: /Kenya/ }));
    expect(screen.getByRole('combobox', { name: 'Country code' })).toHaveTextContent('+254');
    await user.type(screen.getByRole('textbox', { name: 'Phone' }), '712 345 678');
    expect(screen.getByLabelText('e164')).toHaveTextContent('+254712345678');
  });
});
