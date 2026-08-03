import { ApiError } from '@/lib/api-client';

/**
 * Classifies a failed lifecycle command into the handful of things that actually go wrong,
 * so every aggregate reports them identically.
 *
 * Projects, contracts and applications all move through status machines enforced server-side
 * (`constraints.md:299` — the server is the authority). The UI offers only commands it
 * believes will succeed, but a command can still fail: someone else moved the record first,
 * the workflow is not configured, or this user is not permitted.
 *
 * `workflow-not-configured` is the one worth separating out. The API answers `422` when a
 * `WorkflowRequirementPolicy` is REQUIRED but no active binding exists
 * (`workflow-trigger-resolver.service.ts:128`). Nothing the user does can fix that — it is
 * a system configuration gap — so telling them to "try again" wastes their time. The
 * message must send them to an administrator instead, which is what
 * `apps/web/CLAUDE.md:216` requires.
 */
export type LifecycleErrorKind =
  /** 422 — the approval workflow this transition requires has not been configured. */
  | 'workflow-not-configured'
  /** 400 — the record is no longer in the status this command expects. */
  | 'invalid-transition'
  /** 403 — authenticated, but not permitted to run this command. */
  | 'forbidden'
  /** 404 — the record is gone. */
  | 'not-found'
  /** 409 — a uniqueness or state conflict, e.g. a duplicate contract number. */
  | 'conflict'
  | 'unknown';

export interface LifecycleError {
  kind: LifecycleErrorKind;
  /**
   * The server's own message, when it sent one.
   *
   * Worth showing for `invalid-transition`: the API explains precisely what it expected
   * ("Cannot 'submit' an IPA with status 'SUBMITTED'. Expected 'APPROVED_FOR_SUBMISSION'."),
   * which is more useful than anything generic the UI could invent. Empty when the server
   * sent nothing usable.
   */
  serverMessage: string;
}

/**
 * `401` is deliberately absent from the mapping. The API client resolves it before a caller
 * ever sees it — refreshing the token and retrying, or ending the session (see
 * `api-client.ts:106-122`). A 401 reaching here means the session is already being torn
 * down, so it falls through to `unknown` and the redirect wins the race.
 */
const KIND_BY_STATUS: Record<number, LifecycleErrorKind> = {
  400: 'invalid-transition',
  403: 'forbidden',
  404: 'not-found',
  409: 'conflict',
  422: 'workflow-not-configured',
};

export function toLifecycleError(error: unknown): LifecycleError {
  if (!(error instanceof ApiError)) {
    return { kind: 'unknown', serverMessage: '' };
  }

  return {
    kind: KIND_BY_STATUS[error.status] ?? 'unknown',
    // `message` holds class-validator's array joined with newlines; 'Request failed' is the
    // client's own placeholder when the body carried nothing, and is not worth surfacing.
    serverMessage: error.message === 'Request failed' ? '' : error.message,
  };
}

/**
 * The i18n key for a lifecycle failure, under the `platform.lifecycle.error` namespace.
 *
 * Kept next to the classification so a new kind cannot be added without a message, and so
 * the mapping is testable without rendering anything.
 */
export function lifecycleErrorKey(kind: LifecycleErrorKind): string {
  return `lifecycle.error.${kind}`;
}
