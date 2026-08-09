'use client';

/**
 * Which nav sub-groups the user has collapsed, persisted across navigations.
 *
 * An external store rather than component state, for the same reason `sessionStore` is
 * one: the sidebar unmounts and remounts on every mobile navigation, so anything held in
 * its own state resets under the user. It also has to survive a full reload — a Setup
 * group the user shut should stay shut tomorrow.
 *
 * `useSyncExternalStore` needs a referentially stable snapshot, so the parsed array is
 * cached and only replaced when it actually changes. Returning a fresh array each call
 * would re-render forever.
 *
 * Nothing here is sensitive — it is a list of translation keys — so `localStorage` is
 * appropriate. The rule against it applies to tokens and financial data.
 */

const STORAGE_KEY = 'rukna.nav.collapsed';

const EMPTY: readonly string[] = Object.freeze([]);

let cache: readonly string[] | null = null;
const listeners = new Set<() => void>();

function load(): readonly string[] {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const keys = parsed.filter((v): v is string => typeof v === 'string');
    return keys.length === 0 ? EMPTY : Object.freeze(keys);
  } catch {
    // A corrupt entry, or storage disabled in private browsing, must not take the
    // navigation down with it.
    return EMPTY;
  }
}

function emit(): void {
  listeners.forEach((l) => l());
}

export const navCollapseStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Client snapshot. Cached so the reference is stable between renders. */
  getSnapshot(): readonly string[] {
    cache ??= load();
    return cache;
  },

  /**
   * Server snapshot — always empty, so SSR and the first client render agree and each
   * sub-group falls back to its own `defaultCollapsed`. Reading storage during render
   * would mismatch on hydration for anyone who had collapsed anything.
   */
  getServerSnapshot(): readonly string[] {
    return EMPTY;
  },

  toggle(labelKey: string): void {
    const current = navCollapseStore.getSnapshot();
    const next = current.includes(labelKey)
      ? current.filter((k) => k !== labelKey)
      : [...current, labelKey];

    cache = Object.freeze(next);

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Quota or private browsing — the in-memory state still works for this session.
      }
    }

    emit();
  },
};
