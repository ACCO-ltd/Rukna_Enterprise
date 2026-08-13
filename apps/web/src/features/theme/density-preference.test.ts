import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DENSITY,
  DENSITY_STORAGE_KEY,
  sanitizeDensityPreference,
} from './density-preference';
import { themeInitializationScript } from './theme-script';

describe('density preference', () => {
  it('accepts only supported persisted values', () => {
    expect(sanitizeDensityPreference('comfortable')).toBe('comfortable');
    expect(sanitizeDensityPreference('compact')).toBe('compact');
    expect(sanitizeDensityPreference('cosy')).toBe('comfortable');
    expect(sanitizeDensityPreference('')).toBe('comfortable');
    expect(sanitizeDensityPreference(null)).toBe('comfortable');
  });

  it('defaults to comfortable', () => {
    // Most screens are read, checked and approved rather than typed into, so the
    // roomier default is the safer one. Compact is opt-in for the all-day entry
    // grids — BOQ editors, manual journals, the ledger.
    expect(DEFAULT_DENSITY).toBe('comfortable');
  });

  it('uses a stable namespaced storage key', () => {
    expect(DENSITY_STORAGE_KEY).toBe('rukna.density.preference');
  });
});

describe('pre-hydration script', () => {
  // The blocking script cannot import these modules — it runs before any module
  // graph exists — so it re-states the storage keys and the fallback as string
  // literals. These assertions are the seam that keeps the two copies honest: if
  // a key is renamed on one side only, this fails rather than the preference
  // silently resetting on every page load.
  it('reads the same storage keys the stores write', () => {
    expect(themeInitializationScript).toContain(DENSITY_STORAGE_KEY);
    expect(themeInitializationScript).toContain('rukna.theme.preference');
  });

  it('resolves density before hydration, defaulting to comfortable', () => {
    expect(themeInitializationScript).toContain('dataset.density');
    expect(themeInitializationScript).toContain(DEFAULT_DENSITY);
  });

  it('survives storage access throwing', () => {
    // Safari in private mode throws on localStorage access rather than returning
    // null. An unguarded read here would throw before hydration and take the
    // whole page with it.
    const guardedReads = themeInitializationScript.match(/try\s*\{[^}]*localStorage/g);
    expect(guardedReads).toHaveLength(2);
  });
});
