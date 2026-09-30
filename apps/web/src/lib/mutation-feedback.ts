import { useSyncExternalStore } from 'react';

/**
 * ─── Mutation feedback — one place that makes a successful command visible ─────────
 *
 * A mutation opts in through its `meta` (typed below via TanStack's `Register`), and the
 * mutation-cache subscription in `providers/query-provider.tsx` does the rest. Nothing to remember at the call site, so a
 * new command cannot ship silent the way 100 of them had:
 *
 *   useMutation({
 *     mutationFn: createJournal,
 *     meta: { successToast: { key: 'accounting.feedback.journalSaved', values: (j) => ({ ref: j.reference }) } },
 *   })
 *
 * - `successToast` — the everyday confirmation: a short toast, past tense.
 * - `successDialog` — reserved for the rare, consequential step (contract executed, invoice
 *   posted, period closed). It REPLACES the toast; never both. `when` narrows it to the calls
 *   that are the milestone.
 * - The saved record's row, wherever a `PlatformDataGrid` lists it, tints briefly — keyed by the
 *   `id` on the mutation's result unless `flashRow` says otherwise.
 *
 * Keys are full catalogue paths (`<file>.<path>`), resolved against the root translator. The
 * `mutation-feedback-keys.test.ts` guard fails the build if one does not exist.
 */

type Values = Record<string, string | number>;

/** A catalogue key, optionally with ICU values derived from the result and the variables. */
export type FeedbackMessage =
  | string
  | {
      key: string;
      values?: (data: unknown, variables: unknown) => Values;
    };

export interface MutationFeedbackMeta extends Record<string, unknown> {
  successToast?: FeedbackMessage;
  successDialog?: {
    title: FeedbackMessage;
    description?: FeedbackMessage;
    /**
     * For a hook whose calls are mostly routine but occasionally a milestone (one mutation that
     * approves OR posts an invoice): the dialog shows only when this answers true, and the call
     * falls back to `successToast` otherwise.
     */
    when?: (data: unknown, variables: unknown) => boolean;
  };
  /**
   * Which row to tint. Defaults to the result's `id`. `false` turns it off (a command whose
   * result is not a listed record); a function picks the id from a differently shaped result.
   */
  flashRow?: false | ((data: unknown, variables: unknown) => string | null | undefined);
}

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: MutationFeedbackMeta;
  }
}

export function resolveMessage(
  message: FeedbackMessage,
  data: unknown,
  variables: unknown,
): { key: string; values?: Values } {
  if (typeof message === 'string') return { key: message };
  return { key: message.key, values: message.values?.(data, variables) };
}

/** The id to tint for a finished mutation, or null. */
export function flashRowId(
  meta: MutationFeedbackMeta,
  data: unknown,
  variables: unknown,
): string | null {
  if (meta.flashRow === false) return null;
  if (typeof meta.flashRow === 'function') return meta.flashRow(data, variables) ?? null;
  if (data && typeof data === 'object' && 'id' in data && typeof data.id === 'string')
    return data.id;
  return null;
}

// ─── Recently-saved rows ─────────────────────────────────────────────────────────

/** How long a saved row stays tinted — matches `--animate-row-saved`. */
export const ROW_SAVED_MS = 2400;

let savedIds: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function setSaved(id: string, saved: boolean) {
  const next = new Set(savedIds);
  if (saved) next.add(id);
  else next.delete(id);
  savedIds = next;
  emit();
}

/**
 * Tint a row for `ROW_SAVED_MS`. Saving the same row again restarts the tint: the id is cleared
 * for a tick first so the row drops the animation class and picks it up afresh, and the earlier
 * timer is cancelled so it cannot cut the new tint short.
 */
export function markRowSaved(id: string) {
  const pending = timers.get(id);
  if (pending) clearTimeout(pending);

  const start = () => {
    setSaved(id, true);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        setSaved(id, false);
      }, ROW_SAVED_MS),
    );
  };

  if (savedIds.has(id)) {
    setSaved(id, false);
    timers.set(id, setTimeout(start, 0));
  } else {
    start();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: ReadonlySet<string> = new Set();

/** The ids saved in the last couple of seconds — for a list to tint those rows. */
export function useRecentlySavedRows(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => savedIds,
    () => EMPTY,
  );
}
