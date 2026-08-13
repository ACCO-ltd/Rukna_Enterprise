import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { FormErrorSummary } from './form-error-summary';

// jsdom does not implement scrollIntoView — mock it so focus-link tests can run.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const FIELD_ERRORS = [
  { label: 'Project name', fieldId: 'project-name', message: 'Enter a project name' },
  { label: 'Code', fieldId: 'project-code', message: 'Enter a code' },
];

describe('FormErrorSummary', () => {
  it('renders nothing when there are no errors', () => {
    const { container } = renderWithProviders(
      <FormErrorSummary errors={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('has role="alert" so screen readers announce it immediately', () => {
    renderWithProviders(<FormErrorSummary errors={FIELD_ERRORS} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the default title from messages', () => {
    renderWithProviders(<FormErrorSummary errors={FIELD_ERRORS} />);
    expect(screen.getByText('Please fix the following')).toBeInTheDocument();
  });

  it('renders a custom title when provided', () => {
    renderWithProviders(<FormErrorSummary errors={FIELD_ERRORS} title="Fix these" />);
    expect(screen.getByText('Fix these')).toBeInTheDocument();
  });

  it('renders each field error as a link', () => {
    renderWithProviders(<FormErrorSummary errors={FIELD_ERRORS} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '#project-name');
    expect(links[1]).toHaveAttribute('href', '#project-code');
  });

  it('shows the field label and message in each link', () => {
    renderWithProviders(<FormErrorSummary errors={FIELD_ERRORS} />);
    expect(screen.getByText(/Project name/)).toBeInTheDocument();
    expect(screen.getByText(/Enter a project name/)).toBeInTheDocument();
  });

  it('renders non-field formErrors as plain text items', () => {
    renderWithProviders(
      <FormErrorSummary errors={[]} formErrors={['Server rejected the request.']} />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Server rejected the request.')).toBeInTheDocument();
  });

  it('shows both field errors and formErrors when both are present', () => {
    renderWithProviders(
      <FormErrorSummary
        errors={FIELD_ERRORS}
        formErrors={['Duplicate code detected.']}
      />,
    );
    expect(screen.getByText('Duplicate code detected.')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('clicking a field link calls focus on the target element', async () => {
    const user = userEvent.setup();
    const input = document.createElement('input');
    input.id = 'project-name';
    document.body.appendChild(input);

    renderWithProviders(
      <FormErrorSummary
        errors={[{ label: 'Project name', fieldId: 'project-name', message: 'Required' }]}
      />,
    );

    await user.click(screen.getByRole('link', { name: /Project name/ }));
    expect(document.activeElement).toBe(input);

    document.body.removeChild(input);
  });
});
