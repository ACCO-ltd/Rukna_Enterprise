import { PERMISSIONS, type RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Who sees money on procurement list read models: holders of cost visibility
 * (`view:commitment-ledger`) — the gate the PO money reads already use (ADR-043 decision 4:
 * Procurement Manager, Construction Director, Finance Officer yes; Project Manager / Site
 * Engineer no). `view:financial-position` is the project P&L permission and is deliberately not
 * held by the Procurement Manager, so it is not the gate for procurement figures.
 */
export function canSeeProcurementMoney(identity: RequestIdentity): boolean {
  return identity.permissions.includes(PERMISSIONS.commitmentsView);
}

/** A money figure for a list row: 2-dp string when visible, else null. */
export function moneyOrNull(visible: boolean, amount: Decimal | null): string | null {
  if (!visible || amount === null) return null;
  return amount.toFixed(2);
}
