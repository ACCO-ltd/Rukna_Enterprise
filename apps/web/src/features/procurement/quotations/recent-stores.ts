/**
 * The buyer's recent stores, kept on the phone so the store sheet opens with the places they
 * actually buy from as one-tap chips. Per organization and user; nothing here is evidence — the
 * server records which store each quote names.
 */

import type { StoreChoice } from './capture/upload-queue';
import { storeKey } from './quote-rules';

export const RECENT_STORE_LIMIT = 8;

function key(owner: string): string {
  return `rukna.quotes.recentStores.${owner}`;
}

export function readRecentStores(owner: string | null, storage: Storage | null = safeStorage()): StoreChoice[] {
  if (!owner || !storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key(owner)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is StoreChoice =>
        Boolean(entry) && typeof entry === 'object' && typeof (entry as StoreChoice).label === 'string',
    );
  } catch {
    return [];
  }
}

/** Most recent first, de-duplicated by store identity, capped. */
export function rememberStore(
  owner: string | null,
  choice: StoreChoice,
  storage: Storage | null = safeStorage(),
): StoreChoice[] {
  if (!owner || !storage) return [];
  const wanted = storeKey(choice);
  const next = [choice, ...readRecentStores(owner, storage).filter((s) => storeKey(s) !== wanted)].slice(
    0,
    RECENT_STORE_LIMIT,
  );
  try {
    storage.setItem(key(owner), JSON.stringify(next));
  } catch {
    // Storage full or blocked: recent chips are a convenience.
  }
  return next;
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
