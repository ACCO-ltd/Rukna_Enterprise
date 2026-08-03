import { ContractStatus } from '@erp/types';

import type { Contract } from './types';

/**
 * Which commands a contract will accept in its current state.
 *
 * Mirrors `ContractService`'s own rules exactly — `TRANSITIONS`, `CANCEL_ALLOWED_FROM`,
 * the ACTIVE-only terminate guard and the DRAFT-only edit rule. The server remains the
 * authority (`constraints.md:299`); this exists so the UI offers only commands that will
 * succeed rather than presenting buttons that answer 400.
 *
 * Two differences from projects are worth stating, because assuming they match is the easy
 * mistake:
 *
 *  - **Cancel stops being available once the contract is ACTIVE.** A project can be
 *    cancelled while active; a contract that has been executed cannot — it is terminated
 *    instead. The two are not synonyms: cancelled means it never took effect, terminated
 *    means it did and was stopped early.
 *  - **`FINAL_ACCOUNT_PENDING` has no forward command that reaches it.** A contract enters
 *    that state only when its project records practical completion, which moves every
 *    ACTIVE contract on the project at once. So `close` is reachable but the step before
 *    it is not, and the detail screen has to explain that rather than show a dead button.
 */
export type ContractCommand = 'submit' | 'approve-review' | 'execute' | 'close';

/** The single lifecycle command available from each status, if any. */
const NEXT_COMMAND: Partial<Record<ContractStatus, ContractCommand>> = {
  [ContractStatus.DRAFT]: 'submit',
  [ContractStatus.UNDER_REVIEW]: 'approve-review',
  [ContractStatus.PENDING_SIGNATURE]: 'execute',
  [ContractStatus.FINAL_ACCOUNT_PENDING]: 'close',
};

const CANCEL_ALLOWED_FROM: ContractStatus[] = [
  ContractStatus.DRAFT,
  ContractStatus.UNDER_REVIEW,
  ContractStatus.PENDING_SIGNATURE,
];

export interface ContractActions {
  /** The forward lifecycle step, or null when there is none. */
  advance: ContractCommand | null;
  canEdit: boolean;
  canCancel: boolean;
  canTerminate: boolean;
  /**
   * True while the contract is ACTIVE and therefore waiting on its project to record
   * practical completion before it can be closed. The detail view explains this instead of
   * leaving the user hunting for a missing button.
   */
  awaitingPracticalCompletion: boolean;
}

export function getContractActions(contract: Contract): ContractActions {
  return {
    advance: NEXT_COMMAND[contract.status] ?? null,
    canEdit: contract.status === ContractStatus.DRAFT,
    canCancel: CANCEL_ALLOWED_FROM.includes(contract.status),
    canTerminate: contract.status === ContractStatus.ACTIVE,
    awaitingPracticalCompletion: contract.status === ContractStatus.ACTIVE,
  };
}

/**
 * Commands that cannot be undone and therefore need confirming first.
 *
 * `execute` is the one that is easy to underrate: it freezes the client's name and tax
 * number onto the contract permanently (`contract.service.ts:124-128`). From that point
 * the contract names whatever the client record said at that instant, and correcting a
 * misspelling on the client afterwards will not change what the contract says.
 */
export function requiresConfirmation(command: ContractCommand): boolean {
  return command === 'execute' || command === 'close';
}
