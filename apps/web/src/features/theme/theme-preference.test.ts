import { describe, expect, it } from 'vitest';

import {
  resolveTheme,
  sanitizeThemePreference,
  THEME_STORAGE_KEY,
} from './theme-preference';

describe('theme preference', () => {
  it('accepts only supported persisted values', () => {
    expect(sanitizeThemePreference('light')).toBe('light');
    expect(sanitizeThemePreference('dark')).toBe('dark');
    expect(sanitizeThemePreference('system')).toBe('system');
    expect(sanitizeThemePreference('sepia')).toBe('system');
    expect(sanitizeThemePreference(null)).toBe('system');
  });

  it('resolves explicit preferences without consulting the system', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('resolves the system preference from the operating-system setting', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('uses a stable namespaced storage key', () => {
    expect(THEME_STORAGE_KEY).toBe('rukna.theme.preference');
  });
});
