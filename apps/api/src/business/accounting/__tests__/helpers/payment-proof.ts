/**
 * PM-1 — every new receipt names its payment method and that method's proof. Tests that are not
 * about the proof take a bank transfer with a reference nobody else uses.
 */
let seq = 0;

export function transferProof(valueDate = '2025-01-01') {
  seq += 1;
  return {
    paymentMethod: 'BANK_TRANSFER' as const,
    issuer: 'Test Bank',
    payerName: 'Test Client',
    instrumentNumber: `TT-${process.pid}-${Date.now().toString(36)}-${seq}`,
    instrumentDate: valueDate,
  };
}
