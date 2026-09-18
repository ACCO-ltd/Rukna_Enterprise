'use client';

/**
 * Slice 6B: collection events are now persisted server-side via the commercial API.
 * This context is a no-op pass-through — dialogs call real mutations instead of
 * dispatching local actions.  The hooks are kept so consumers that haven't been updated
 * yet don't immediately break; they return empty/noop values.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { CollectionEvent } from './collection-events';

// ─── No-op context ────────────────────────────────────────────────────────────

type Store = Map<string, CollectionEvent[]>;

interface ContextValue {
  getEvents: (invoiceId: string) => CollectionEvent[];
  getAllEvents: () => Store;
}

const _emptyStore: Store = new Map();
const CollectionEventContext = createContext<ContextValue>({
  getEvents: () => [],
  getAllEvents: () => _emptyStore,
});

export function CollectionEventProvider({ children }: { children: ReactNode }) {
  return (
    <CollectionEventContext.Provider
      value={{ getEvents: () => [], getAllEvents: () => _emptyStore }}
    >
      {children}
    </CollectionEventContext.Provider>
  );
}

// ─── Hooks (kept for backward compat — return empty values) ──────────────────

export function useCollectionEvents(_invoiceId: string): CollectionEvent[] {
  return useContext(CollectionEventContext).getEvents(_invoiceId);
}

export function useAllCollectionEvents(): Store {
  return useContext(CollectionEventContext).getAllEvents();
}

/**
 * Kept as a no-op stub so old dialog components that still import it compile.
 * After dialogs are migrated to real mutations, remove this export.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useCollectionEventDispatch(): (..._args: any[]) => void {
  return () => undefined;
}

// Kept for backward compat — no longer needed
export type { CollectionEvent };
