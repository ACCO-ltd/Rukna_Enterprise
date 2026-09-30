import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Button } from './button';

describe('Button loading', () => {
  it('disables itself, announces busy and swaps in the loading text', async () => {
    const onClick = vi.fn();
    render(
      <Button loading loadingText="Saving…" onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps its label when no loading text is given', () => {
    render(<Button loading>Post</Button>);
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
  });

  it('is an ordinary button when not loading', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it('still honours an explicit disabled', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
