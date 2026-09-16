import { ContractStatus } from '@erp/types';

import type { Contract } from './types';

/**
 * Which commands a contract will accept in its current state.
 *
 * Mirrors `ContractService`'s own rules exactly — `TRANSITIONS`, `CANCEL_ALLOWED_FROM`,
 * the ACTIVE-only terminate/reopen guards and the DRAFT-only edit rule. The server remains
 * the authority (`constraints.md:299`); this exists so the UI offers only commands that will
 * succeed rather than presenting buttons that answer 400.
 *
 * ACCO signs its contracts on paper, so the in-app lifecycle collapsed to one forward step:
 * `activate` takes a physically-signed DRAFT straight to ACTIVE (it froze client identity and
 * evidence, formerly `execute`'s job). `reopen` is its reverse — ACTIVE back to DRAFT for
 * correction — and, like `cancel`/`terminate`, carries a reason, so it is not part of the
 * forward `ContractCommand` union; it has its own api function and hook.
 *
 * Two differences from projects are worth stating, because assuming they match is the easy
 * mistake:
 *
 *  - **Cancel stops being available once the contract is ACTIVE.** A project can be
 *    cancelled while active; a contract that has gone live cannot — it is reopened (to
 *    correct) or terminated (to stop) instead. Cancelled means it never took effect.
 *  - **`FINAL_ACCOUNT_PENDING` has no forward command that reaches it.** A contract enters
 *    that state only when its project records practical completion, which moves every
 *    ACTIVE contract on the project at once. So `close` is reachable but the step before
 *    it is not, and the detail screen has to explain that rather than show a dead button.
 */
export type ContractCommand = 'activate' | 'close';

/** The single forward lifecycle command available from each status, if any. */
const NEXT_COMMAND: Partial<Record<ContractStatus, ContractCommand>> = {
  [ContractStatus.DRAFT]: 'activate',
  [ContractStatus.FINAL_ACCOUNT_PENDING]: 'close',
};

const CANCEL_ALLOWED_FROM: ContractStatus[] = [ContractStatus.DRAFT];

export interface ContractActions {
  /** The forward lifecycle step, or null when there is none. */
  advance: ContractCommand | null;
  canEdit: boolean;
  canCancel: boolean;
  canTerminate: boolean;
  /** True while ACTIVE — the contract can be reversed back to DRAFT for correction. */
  canReopen: boolean;
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
    canReopen: contract.status === ContractStatus.ACTIVE,
    awaitingPracticalCompletion: contract.status === ContractStatus.ACTIVE,
  };
}

/**
 * Forward commands that cannot be undone and therefore need confirming first.
 *
 * `activate` is the one that is easy to underrate: it freezes the client's name and tax
 * number onto the contract permanently and opens billing. From that point the contract names
 * whatever the client record said at that instant, and correcting a misspelling on the client
 * afterwards will not change what the contract says. `close` is final too. (`reopen` also
 * confirms, but through its own reason dialog, not this predicate.)
 */
export function requiresConfirmation(command: ContractCommand): boolean {
  return command === 'activate' || command === 'close';
}
