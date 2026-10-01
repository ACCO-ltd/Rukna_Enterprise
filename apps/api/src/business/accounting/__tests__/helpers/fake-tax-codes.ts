import { Decimal } from '@prisma/client/runtime/library';

/**
 * A `TaxCodeService` stand-in for unit specs that build `ClientInvoiceService` by hand (ADR-041):
 * every invoice resolves to the organisation default, a 5% sales code. Specs about tax resolution
 * itself use the real service against a database.
 */
export function fakeTaxCodes(ratePercent: string | number = 5) {
  return {
    resolveForClientInvoice: jest.fn().mockResolvedValue({
      taxCodeId: 'tax-default',
      ratePercent: new Decimal(ratePercent),
    }),
  };
}
