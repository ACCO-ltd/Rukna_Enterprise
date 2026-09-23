import { render, screen } from '@testing-library/react';
import { FormSection } from '@erp/ui';
import { describe, expect, it } from 'vitest';

describe('FormSection', () => {
  it('renders the title without a step badge by default', () => {
    render(<FormSection title="Identity">content</FormSection>);

    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('renders a step badge before the title when step is given', () => {
    render(
      <FormSection title="Procurement Method" step={1}>
        content
      </FormSection>,
    );

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Procurement Method')).toBeInTheDocument();
  });

  it('renders the step badge in the plain variant too', () => {
    render(
      <FormSection title="Tax Treatment" step={2} variant="plain">
        content
      </FormSection>,
    );

    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
