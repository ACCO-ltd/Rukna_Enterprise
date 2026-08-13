import type { Metadata } from 'next';

import { Gallery } from '@/features/design-system/components/gallery';

/**
 * `/design` — the design system's review surface.
 *
 * Deliberately outside the `(app)` route group: it carries no sidebar, no
 * breadcrumb and no tenant chrome, because a specimen framed by product
 * navigation is being reviewed against that navigation rather than on its own.
 * It is also not in `nav-groups.ts` — this is a surface for whoever is building
 * a component, not a page a tenant should find.
 *
 * Two deliberate exceptions to the rules in `apps/web/CLAUDE.md`, both scoped to
 * this feature:
 *
 *   1. **English-only.** The i18n rule exists so no tenant-facing string is
 *      untranslated. This page has no tenant-facing strings; it documents the
 *      system for the people building it. Adding several hundred keys nobody
 *      reads would make the en/ar parity guard in `catalogues.test.ts` measure
 *      noise. Specimens are still verified in Arabic through the page's own
 *      direction toggle.
 *   2. **No API.** Every figure on the page is a literal. Nothing here may reach
 *      for `apiClient` — a component gallery that needs a running backend stops
 *      being usable exactly when it is needed most.
 */
export const metadata: Metadata = {
  title: 'Design system · Rukna',
  robots: { index: false, follow: false },
};

export default function DesignSystemPage() {
  return <Gallery />;
}
