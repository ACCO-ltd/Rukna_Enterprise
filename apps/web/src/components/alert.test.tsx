import { render, screen } from '@testing-library/react';
import { Alert } from '@erp/ui';
import { describe, expect, it } from 'vitest';

describe('Alert', () => {
  it('renders the title and message without icon or action', () => {
    render(<Alert variant="error" title="Journal could not be posted" messages={['Period is closed.']} />);

    expect(screen.getByText('Journal could not be posted')).toBeInTheDocument();
    expect(screen.getByText('Period is closed.')).toBeInTheDocument();
  });

  it('renders an optional leading icon', () => {
    render(
      <Alert variant="warning" title="Approaching threshold" icon={<span data-testid="alert-icon" />} />,
    );

    expect(screen.getByTestId('alert-icon')).toBeInTheDocument();
  });

  it('renders an optional trailing action', () => {
    render(
      <Alert variant="warning" title="Structural materials at 91%" action={<button>Investigate</button>} />,
    );

    expect(screen.getByRole('button', { name: 'Investigate' })).toBeInTheDocument();
  });

  it('still announces errors assertively with icon and action present', () => {
    render(
      <Alert
        variant="error"
        title="Post failed"
        icon={<span aria-hidden="true" />}
        action={<button>Retry</button>}
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
