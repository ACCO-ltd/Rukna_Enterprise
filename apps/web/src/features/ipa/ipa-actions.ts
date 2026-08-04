import { IpaStatus } from '@erp/types';

import type { Ipa } from './types';

/**
 * Which commands a payment application will accept in its current state.
 *
 * Mirrors `IpaService`'s `TRANSITIONS`, `MUTABLE_STATUSES` and `CANCEL_FROM` exactly. The
 * server remains the authority; this exists so the UI offers only commands that will
 * succeed.
 *
 * ─── What is different here ─────────────────────────────────────────────────────
 *
 * This is the first aggregate whose lifecycle BRANCHES. Projects and contracts each have
 * at most one forward step from any status; an application sitting in
 * `PENDING_INTERNAL_APPROVAL` has two, and they go opposite ways:
 *
 *   approve-for-submission → APPROVED_FOR_SUBMISSION   (forward)
 *   return-for-revision    → RETURNED_FOR_REVISION     (back to editable)
 *
 * So `advance` is a LIST, not a single command, and the caller renders whichever it gets.
 *
 * `RETURNED_FOR_REVISION` is the only status in the platform reached by moving against the
 * flow, and it restores editability — items and deductions become mutable again.
 */
export type IpaCommand =
  'submit-for-approval' | 'return-for-revision' | 'approve-for-submission' | 'submit';

/**
 * Commands available from each status, in the order they should be offered.
 *
 * ⚠ `RETURNED_FOR_REVISION` has NO forward command, and that is not an omission here — it
 * is what the server does. `TRANSITIONS['submit-for-approval']` accepts `DRAFT` and
 * nothing else, so an application returned for revision can never be resubmitted:
 *
 *     POST /ipa/:id/submit-for-approval
 *     → "Cannot 'submit-for-approval' an IPA with status 'RETURNED_FOR_REVISION'.
 *        Expected 'DRAFT'."
 *
 * Verified against the running API. The state is a trap: its lines ARE editable
 * (`MUTABLE_STATUSES` includes it), so a reviewer's feedback can be acted on, and then the
 * only exit is to cancel and start again. Raised as C14.
 *
 * This module reports what the server accepts. The detail screen explains the dead end
 * rather than offering a button that answers 400.
 */
const COMMANDS_BY_STATUS: Partial<Record<IpaStatus, IpaCommand[]>> = {
  [IpaStatus.DRAFT]: ['submit-for-approval'],
  // Approve first: it is the expected outcome, and the destructive-ish one reads better second.
  [IpaStatus.PENDING_INTERNAL_APPROVAL]: ['approve-for-submission', 'return-for-revision'],
  [IpaStatus.APPROVED_FOR_SUBMISSION]: ['submit'],
};

/**
 * True when the application is editable but has nowhere to go — the C14 dead end.
 *
 * Worth its own flag rather than being inferred from an empty command list, because the
 * screen has to say something specific: the work can be corrected, but the correction
 * cannot be submitted.
 */
export function isStuckAfterReturn(status: IpaStatus): boolean {
  return status === IpaStatus.RETURNED_FOR_REVISION;
}

/**
 * Statuses in which items and deductions can be added or removed.
 *
 * `IpaService.addItem` rejects anything else with a 400, and the same set governs
 * deductions. Note that this is NOT the same as "not yet submitted": an application
 * awaiting internal approval is frozen, and only a return-for-revision reopens it.
 */
const MUTABLE_STATUSES: IpaStatus[] = [IpaStatus.DRAFT, IpaStatus.RETURNED_FOR_REVISION];

const CANCEL_FROM: IpaStatus[] = [IpaStatus.DRAFT, IpaStatus.RETURNED_FOR_REVISION];

export interface IpaActions {
  /** Every forward or backward command available now. Empty in a terminal state. */
  commands: IpaCommand[];
  /** True while items and deductions can be changed. */
  canEditLines: boolean;
  canCancel: boolean;
  /** True once the application is final and nothing about it can change. */
  isFinal: boolean;
}

export function getIpaActions(ipa: Ipa): IpaActions {
  return {
    commands: COMMANDS_BY_STATUS[ipa.status] ?? [],
    canEditLines: MUTABLE_STATUSES.includes(ipa.status),
    canCancel: CANCEL_FROM.includes(ipa.status),
    isFinal: ipa.status === IpaStatus.SUBMITTED || ipa.status === IpaStatus.CANCELLED,
  };
}

/**
 * Commands that need confirming before they fire.
 *
 * `submit` is the point of no return: an application becomes immutable at SUBMITTED and
 * there is no command back. `return-for-revision` is worth a stop too — it sends the
 * application back to the author, which is a decision about someone else's work.
 *
 * `approve-for-submission` also assigns the permanent application number
 * (`ipa.service.ts:112`), which is the first time this claim gets an identity the client
 * will see. That is worth flagging in the confirmation text.
 */
export function ipaCommandNeedsConfirmation(command: IpaCommand): boolean {
  return command === 'submit' || command === 'return-for-revision';
}

/** Commands whose primary button should read as destructive rather than progressive. */
export function isRegressiveCommand(command: IpaCommand): boolean {
  return command === 'return-for-revision';
}
