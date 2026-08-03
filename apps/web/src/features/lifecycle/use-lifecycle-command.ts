'use client';

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';

import { toLifecycleError, type LifecycleError } from './lifecycle-error';

/**
 * Runs one lifecycle command against the API and refreshes what it affected.
 *
 * Every status-machine aggregate — project, contract, payment application — needs the same
 * three things, and they are worth having in one place rather than three:
 *
 *  1. **Invalidate rather than patch.** Several transitions answer 200 with an empty body
 *     (B6), so there is often no updated resource to write back. A status change also moves
 *     figures on other screens: approving a project changes the dashboard's counts, and
 *     `practical-completion` moves every ACTIVE contract on that project to
 *     FINAL_ACCOUNT_PENDING server-side. One invalidation keeps all of them honest; a
 *     targeted cache write would leave siblings stale.
 *  2. **Classify the failure identically.** In particular the `422` that means "no approval
 *     workflow is configured", which must never read as a retryable error.
 *  3. **One seam for approval instances.** `ipa.service.ts:99` resolves a workflow policy
 *     and then transitions directly — creating an approval instance is Sprint 4+ work.
 *     When that lands, `submit-for-approval` stops completing the transition and starts
 *     opening a pending approval. That change belongs here, once, rather than in each
 *     detail screen.
 *
 * `invalidate` takes the BROAD key for the aggregate (`projectKeys.all`), not the detail
 * key — that is what catches the list and dashboard views alongside the record itself.
 */
export function useLifecycleCommand<TArgs = void>(
  run: (args: TArgs) => Promise<unknown>,
  invalidate: QueryKey | QueryKey[],
) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: run,
    onSuccess: async () => {
      const keys = isKeyList(invalidate) ? invalidate : [invalidate];
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });

  const failure: LifecycleError | null = mutation.error ? toLifecycleError(mutation.error) : null;

  return { ...mutation, failure };
}

/**
 * A `QueryKey` is itself an array, so `Array.isArray` cannot tell one key from a list of
 * keys. Every key in this app starts with a string scope (`['projects', …]`), so a first
 * element that is itself an array means the caller passed several keys.
 */
function isKeyList(value: QueryKey | QueryKey[]): value is QueryKey[] {
  return Array.isArray(value[0]);
}
