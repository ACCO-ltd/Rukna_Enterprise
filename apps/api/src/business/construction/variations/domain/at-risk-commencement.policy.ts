import { Decimal } from '@prisma/client/runtime/library';

import { AT_RISK_COMMENCEMENT_CHAIN } from '../../../../platform/workflows/seeders/acco-lifecycle-chains.js';
import type { VariationOrderStatusValue } from './variation-order.policy.js';

/**
 * ADR-026 CONST-VAR-011 (Variations Phase 5, Route 7B) — the pure decision behind at-risk commencement.
 *
 * ZERO infrastructure (no Prisma, no Nest, no ConfigService). It owns two things:
 *   1. Whether the VO is in a state where at-risk commencement even makes sense (a pre-CLIENT_APPROVED,
 *      non-terminal state — you cannot authorise starting "at risk" once the client has approved or the
 *      VO is dead).
 *   2. Given an exposure amount and the config-driven cap, WHICH fixed chain applies: CD+CFO below the
 *      cap, adding the CEO above it. The cap comparison is the whole point of OQ-1.
 *
 * The cap is passed in (the service reads it from ConfigService) so this stays a pure function of its
 * inputs and is unit-testable without the config layer.
 */

// The VO states in which an at-risk commencement authorisation is meaningful: work has not yet been
// client-approved and the VO is still live. CLIENT_APPROVED (the work is now sanctioned normally) and
// the terminal states (REJECTED / WITHDRAWN — there is nothing to commence) are excluded.
const AT_RISK_ELIGIBLE_STATUSES: ReadonlySet<VariationOrderStatusValue> =
  new Set<VariationOrderStatusValue>(['DRAFT', 'PENDING_INTERNAL', 'INTERNAL_APPROVED']);

export interface AtRiskAuthoritySignatories {
  /** Whether the CEO signature is required (exposure strictly above the cap). */
  ceoRequired: boolean;
  /** The required approving roles, in order (the fixed chain for the resolved band). */
  requiredRoles: readonly string[];
}

export const AtRiskCommencementPolicy = {
  /**
   * CONST-VAR-011: at-risk commencement is legal only while the VO is pre-CLIENT_APPROVED and live.
   * A CLIENT_APPROVED VO no longer needs an at-risk route (the work is sanctioned); a terminal VO has
   * nothing to commence.
   */
  eligible(status: VariationOrderStatusValue): boolean {
    return AT_RISK_ELIGIBLE_STATUSES.has(status);
  },

  /**
   * OQ-1: the exposure→authority rule. At or below the cap, CD + CFO jointly suffice; strictly above
   * the cap, the CEO must also sign. The comparison is on absolute money (a large omission carries the
   * same at-risk exposure as a large addition — but the caller supplies a non-negative exposure figure
   * that expresses "how much work are we starting on trust", so no sign handling is needed here).
   *
   * `cap` and `exposure` are Decimals so money math is exact. `> cap` (strictly above) is faithful to
   * the memo example ("CD + CFO can authorise up to USD 25,000; above that the CEO signs too").
   */
  requiredSignatories(exposure: Decimal, cap: Decimal): AtRiskAuthoritySignatories {
    const ceoRequired = exposure.greaterThan(cap);
    return {
      ceoRequired,
      requiredRoles: ceoRequired
        ? AT_RISK_COMMENCEMENT_CHAIN.aboveCap
        : AT_RISK_COMMENCEMENT_CHAIN.belowCap,
    };
  },
} as const;
