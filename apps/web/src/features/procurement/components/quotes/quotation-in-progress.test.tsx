import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

import { QuotationInProgressNotice, quotationInProgress } from './quotation-in-progress';

const refusal = new ApiError(409, 'Quotation in progress', 'CONFLICT', [], {
  code: 'QUOTATION_IN_PROGRESS',
  quotationRequestId: 'qr1',
  quotationNumber: 'QR-00041',
  materialRequestId: 'mr1',
});

describe('QUOTATION_IN_PROGRESS on a manual PO create/revise', () => {
  it('says to order from the quotation, with a link to it', () => {
    renderWithProviders(<QuotationInProgressNotice error={refusal} />);
    expect(
      screen.getByText('This request is being quoted (QR-00041). Order it from the quotation.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open QR-00041' })).toHaveAttribute('href', '/procurement/quotes/qr1');
  });

  it('sends remaining quantity to a new quotation round on QUOTATION_ROUND_REQUIRED', () => {
    renderWithProviders(
      <QuotationInProgressNotice
        error={
          new ApiError(409, 'Round required', 'CONFLICT', [], {
            code: 'QUOTATION_ROUND_REQUIRED',
            quotationRequestId: 'qr1',
            quotationNumber: 'QR-00041',
            materialRequestId: 'mr1',
          })
        }
      />,
    );
    expect(screen.getByText('Any quantity left needs a new quotation round.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get quotes on the material request' })).toHaveAttribute(
      'href',
      '/procurement/requests/mr1',
    );
  });

  it('renders nothing for any other refusal', () => {
    const { container } = renderWithProviders(
      <QuotationInProgressNotice error={new ApiError(409, 'x', 'CONFLICT', [], { code: 'OTHER' })} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(quotationInProgress(refusal)).toEqual({
      kind: 'IN_PROGRESS',
      quotationRequestId: 'qr1',
      quotationNumber: 'QR-00041',
      materialRequestId: 'mr1',
    });
  });
});
