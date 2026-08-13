export const DENSITY_STORAGE_KEY = 'rukna.density.preference';

/**
 * Row and control height preference.
 *
 * `comfortable` (44px) is the default because most screens are read, checked
 * and approved rather than typed into. `compact` (36px) exists for the screens
 * where someone spends a whole shift entering rows — BOQ editors, manual
 * journals, the account ledger, the trial balance — and shows roughly a third
 * more data per screen.
 *
 * Deliberately not a `system` option, unlike the theme: the operating system
 * has no notion of table density, so there is nothing to track.
 */
export type DensityPreference = 'comfortable' | 'compact';

export const DEFAULT_DENSITY: DensityPreference = 'comfortable';

export function sanitizeDensityPreference(value: string | null): DensityPreference {
  return value === 'compact' || value === 'comfortable' ? value : DEFAULT_DENSITY;
}
