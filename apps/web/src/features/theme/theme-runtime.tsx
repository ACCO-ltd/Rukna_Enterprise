'use client';

import { useThemePreference } from './theme-store';

/** Keeps system and cross-tab theme changes active on every route, including login. */
export function ThemeRuntime() {
  useThemePreference();
  return null;
}
