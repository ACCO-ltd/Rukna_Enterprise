'use client';

import { useCallback, useState } from 'react';

import { ApiError } from '@/lib/api-client';

/**
 * Drives a governed command through the ADR-011/015 gate.
 *
 * A governed command (PO submit, bill submit, payment approve) returns `409` with
 * `error.details.approvalInstanceId` when a DOA binding is configured, instead of
 * transitioning. The flow the UI must run:
 *
 *   run() → 409 → hold `approvalInstanceId`, render the ApprovalPanel for it →
 *   approvers act → once the instance is APPROVED, run() again (the "re-drive") →
 *   the gate consumes the approval and the command proceeds.
 *
 * With no binding configured the command simply succeeds on the first `run()` and
 * `gate` stays null — so this is safe to wrap around every governed action.
 */
export interface GatedCommandState {
  /** Present while an approval is pending for this command. */
  approvalInstanceId: string | null;
  /** True while the command (or a re-drive) is in flight. */
  pending: boolean;
  /** A non-gate error message, if the last run failed for another reason. */
  error: string | null;
}

export interface UseGatedCommandResult<TArgs extends unknown[]> extends GatedCommandState {
  /** Invoke (or re-drive) the command. Resolves `{ gated }` — `true` means an approval is pending. */
  run: (...args: TArgs) => Promise<{ gated: boolean }>;
  /** Forget the pending approval (e.g. after the entity moved on). */
  reset: () => void;
}

export function useGatedCommand<TArgs extends unknown[]>(
  command: (...args: TArgs) => Promise<unknown>,
): UseGatedCommandResult<TArgs> {
  const [approvalInstanceId, setApprovalInstanceId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: TArgs): Promise<{ gated: boolean }> => {
      setPending(true);
      setError(null);
      try {
        await command(...args);
        setApprovalInstanceId(null);
        return { gated: false };
      } catch (e) {
        const instanceId =
          e instanceof ApiError && e.status === 409
            ? (e.details?.approvalInstanceId as string | undefined)
            : undefined;

        if (instanceId) {
          setApprovalInstanceId(instanceId);
          return { gated: true };
        }
        setError(e instanceof Error ? e.message : 'Command failed');
        throw e;
      } finally {
        setPending(false);
      }
    },
    [command],
  );

  const reset = useCallback(() => {
    setApprovalInstanceId(null);
    setError(null);
  }, []);

  return { run, reset, approvalInstanceId, pending, error };
}
