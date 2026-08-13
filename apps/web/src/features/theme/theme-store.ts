'use client';

import { useSyncExternalStore } from 'react';

import {
  resolveTheme,
  sanitizeThemePreference,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from './theme-preference';

const THEME_CHANGE_EVENT = 'rukna-theme-change';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function darkMediaQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
}

function readPreference(): ThemePreference {
  try {
    return sanitizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function applyPreference(preference: ThemePreference): void {
  const isDark = darkMediaQuery()?.matches ?? false;
  const resolved = resolveTheme(preference, isDark);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeColor?.setAttribute('content', resolved === 'dark' ? '#17191d' : '#f4f6f8');
}

function subscribe(onStoreChange: () => void): () => void {
  const media = darkMediaQuery();

  const onPreferenceChange = () => {
    applyPreference(readPreference());
    onStoreChange();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) onPreferenceChange();
  };
  const onSystemChange = () => {
    if (readPreference() === 'system') onPreferenceChange();
  };

  window.addEventListener(THEME_CHANGE_EVENT, onPreferenceChange);
  window.addEventListener('storage', onStorage);
  media?.addEventListener('change', onSystemChange);

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onPreferenceChange);
    window.removeEventListener('storage', onStorage);
    media?.removeEventListener('change', onSystemChange);
  };
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The selected theme still applies for this page when storage is unavailable.
  }
  applyPreference(preference);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readPreference, () => 'system');
}

function readResolvedTheme(): ResolvedTheme {
  return resolveTheme(readPreference(), darkMediaQuery()?.matches ?? false);
}

/** The theme currently painted, including live operating-system changes in System mode. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, readResolvedTheme, () => 'light');
}
