import type { CommercialSummaryResponse } from '@erp/types';

/**
 * The one commercial action worth offering, resolved from state.
 *
 * Modelled on `features/boq/boq-next-step.ts`, for the same reason: a screen with four peer
 * buttons has no answer to "what do I do next", and a *disabled* primary is worse still —
 * the one element drawing the eye is the one that cannot be pressed.
 *
 * Everything here is derived from the server's own `capabilities` and `attention`, so the
 * button can never offer something the API would refuse. When nothing is available it
 * returns `null` and the caller renders no primary at all, rather than a refusal.
 */

export type CommercialNextStepKind =
  | 'CREATE_CONTRACT'
  | 'ADVANCE_CONTRACT'
  | 'GENERATE_INVOICE'
  | 'CREATE_APPLICATION'
  | 'VIEW_HISTORY';

export interface CommercialNextStep {
  kind: CommercialNextStepKind;
  /** Where it goes. Always populated — a step with nowhere to go is not a step. */
  href: string;
  /** How many records the step concerns, for a counted label. */
  count?: number;
}

/** Contract states in which no commercial work can be started (ADR-017 term lifecycle). */
const TERMINAL = new Set(['CLOSED', 'CANCELLED', 'TERMINATED']);
/** States where the contract itself is the work — it is not yet governing anything. */
const PRE_EXECUTION = new Set(['DRAFT', 'UNDER_REVIEW', 'PENDING_SIGNATURE']);

export function resolveCommercialNextStep(
  summary: CommercialSummaryResponse,
  projectId: string,
): CommercialNextStep | null {
  const base = `/projects/${projectId}/commercial`;
  const { mainContract, capabilities, attention } = summary;

  // Nothing governs this project yet. Everything downstream — applications, certificates,
  // invoicing, retention — is unreachable until a contract exists, so this is the only
  // meaningful action on the screen.
  if (!mainContract) {
    const create = attention.find((item) => item.kind === 'NO_MAIN_CONTRACT');
    return create?.actionUrl ? { kind: 'CREATE_CONTRACT', href: create.actionUrl } : null;
  }

  // A closed or terminated contract is a record, not a workspace. Offering "create
  // application" here would invite a 409 from CommercialTermPolicy.
  if (TERMINAL.has(mainContract.status)) {
    return { kind: 'VIEW_HISTORY', href: `${base}/main-contract` };
  }

  // Before execution the contract is the work in progress. Certification cannot begin.
  if (PRE_EXECUTION.has(mainContract.status)) {
    return capabilities.canAdvanceContract
      ? { kind: 'ADVANCE_CONTRACT', href: `${base}/main-contract` }
      : null;
  }

  // Certified work with no invoice behind it outranks raising the next application: the
  // money is already earned and simply has not been asked for.
  const uninvoiced = attention.filter((item) => item.kind === 'UNINVOICED_CERTIFICATE');
  if (uninvoiced.length > 0 && capabilities.canGenerateInvoice) {
    return {
      kind: 'GENERATE_INVOICE',
      href: `${base}/applications`,
      count: uninvoiced.length,
    };
  }

  // An executing contract with nothing outstanding: the next thing is to claim for the
  // period. This is the steady state of a live project.
  if (capabilities.canCreateApplication) {
    return { kind: 'CREATE_APPLICATION', href: `${base}/applications` };
  }

  return null;
}
