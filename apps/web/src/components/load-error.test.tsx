import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { LoadError } from './load-error';

describe('LoadError', () => {
  it('says what failed and retries on Try again', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderWithProviders(<LoadError message="The invoice could not be loaded." onRetry={onRetry} />);
    expect(screen.getByText('The invoice could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('offers no button when there is nothing to retry', () => {
    renderWithProviders(<LoadError message="Not available." />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
