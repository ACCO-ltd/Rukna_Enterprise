'use client';

import { useSyncExternalStore } from 'react';

import {
  DEFAULT_DENSITY,
  DENSITY_STORAGE_KEY,
  sanitizeDensityPreference,
  type DensityPreference,
} from './density-preference';

/**
 * Density preference store.
 *
 * Deliberately the same shape as `theme-store.ts` — same custom event, same
 * `storage` listener for cross-tab sync, same `useSyncExternalStore` read — so
 * there is one pattern for display preferences rather than two. It is a
 * separate module rather than a generalised one because the theme has a
 * `system` mode that resolves against a media query and density does not;
 * merging them would mean a shared abstraction with a branch inside it.
 */
const DENSITY_CHANGE_EVENT = 'rukna-density-change';

function readPreference(): DensityPreference {
  try {
    return sanitizeDensityPreference(window.localStorage.getItem(DENSITY_STORAGE_KEY));
  } catch {
    return DEFAULT_DENSITY;
  }
}

function applyPreference(preference: DensityPreference): void {
  document.documentElement.dataset.density = preference;
}

function subscribe(onStoreChange: () => void): () => void {
  const onPreferenceChange = () => {
    applyPreference(readPreference());
    onStoreChange();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === DENSITY_STORAGE_KEY) onPreferenceChange();
  };

  window.addEventListener(DENSITY_CHANGE_EVENT, onPreferenceChange);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(DENSITY_CHANGE_EVENT, onPreferenceChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function setDensityPreference(preference: DensityPreference): void {
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, preference);
  } catch {
    // The selected density still applies for this page when storage is unavailable.
  }
  applyPreference(preference);
  window.dispatchEvent(new Event(DENSITY_CHANGE_EVENT));
}

export function useDensityPreference(): DensityPreference {
  return useSyncExternalStore(subscribe, readPreference, () => DEFAULT_DENSITY);
}
