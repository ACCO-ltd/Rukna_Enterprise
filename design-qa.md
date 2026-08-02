**Comparison Target**

- Source visual truth: `C:/Users/cshii/.codex/generated_images/019fc393-eb39-7463-b475-ed4627914ca1/exec-408ba33e-3d20-4c14-af98-fb1460400690.png`
- Rendered desktop evidence: `C:/Users/cshii/AppData/Local/Temp/rukna-design-qa/implementation-desktop.png`
- Rendered mobile evidence: `C:/Users/cshii/AppData/Local/Temp/rukna-design-qa/implementation-mobile-en.png`
- Rendered RTL evidence: `C:/Users/cshii/AppData/Local/Temp/rukna-design-qa/implementation-mobile-ar.png`
- State: selected Portfolio Ledger visual system transferred to the existing signed-out login route. The source is an authenticated dashboard, so this comparison evaluates the selected system rather than claiming screen-for-screen layout fidelity.

**Viewport and Normalization**

- Source: 1487 x 1058 pixels.
- Desktop implementation: 1440 x 1024 pixels at a 1440 x 1024 CSS viewport, device density 1.
- Mobile implementation: 360 x 779 captured content at a 375 x 812 CSS viewport, device density 1.
- RTL implementation: 360 x 779 captured content at a 375 x 812 CSS viewport, device density 1.
- No density resampling was used. Full views were compared together; exact pixel overlay was intentionally not used because the source and implementation are different product states.

**Findings**

- No actionable P0, P1, or P2 findings remain.
- Typography: Geist and the Arabic fallback provide clear enterprise hierarchy, appropriate optical weight, readable wrapping, and compact control labels in both directions.
- Spacing and layout: the desktop split surface preserves the source's disciplined grid, crisp dividers, restrained radius, and low elevation. The mobile stack has no horizontal overflow and exposes the form within the first viewport.
- Colors and tokens: charcoal, neutral white/gray, muted blue, and restrained copper map consistently to shared CSS tokens and the selected visual direction. Form status colors remain semantic and legible.
- Image quality and assets: the login target requires no imagery or icons. No placeholder image, CSS drawing, handcrafted SVG, or fake brand asset was introduced.
- Copy and content: tenant, product, security, and access copy is specific to ACCO/Rukna, localized in English and Arabic, and avoids unsupported feature claims.
- Accessibility and behavior: semantic labels, validation descriptions, focus treatment, practical control heights, language pressed state, RTL document direction, password visibility, and error states are implemented.

**Focused Region Comparison**

- The full-view comparison kept the source and desktop implementation in one inspection input. The brand/palette region and the form/control region were readable at full size, so a separate crop was not needed.
- The source's dark charcoal header, white working canvas, blue primary action, copper accent, fine borders, compact typography, and restrained radii are all represented in the login implementation without copying dashboard-only navigation or data controls into the signed-out state.

**Comparison History**

- Pass 1 — P1 primary action visibility: the shared button's `bg-brand-primary` class was not emitted because Tailwind was not scanning `packages/ui`. Added the package source directive in `apps/web/src/app/globals.css`. Post-fix desktop evidence shows a visible blue Sign in action with white text.
- Pass 2 — P2 mobile hierarchy: the tenant panel consumed most of the 375px first viewport and delayed access to the form. Reduced mobile-only padding/type scale and hid secondary explanatory copy below the `sm` breakpoint. Post-fix mobile evidence has no horizontal overflow and begins the form in the first viewport.
- Pass 3 — no P0/P1/P2 findings. English desktop, English mobile, and Arabic RTL renders retain hierarchy and usable controls.

**Primary Interactions Tested**

- English-to-Arabic language switch, cookie preference, route refresh, and `dir="rtl"` rendering.
- Password Show/Hide toggle and input type transition.
- Empty submission validation state.
- Successful login redirect and credential/server error behavior through the automated login suite.
- Browser console collection was attempted after the visual captures, but an open Chrome extension surface blocked the final log read. No visible application error was present in the captured DOM; automated tests, lint, type-check, and the frontend production build provide the remaining runtime coverage.

**Implementation Checklist**

- [x] Shared light-first enterprise tokens and reusable form primitives.
- [x] Existing login route redesigned in place.
- [x] English and Arabic/RTL presentation.
- [x] Desktop and 375px mobile inspection.
- [x] Authentication behavior and validation preserved.

**Follow-up Polish**

- P3: replace the temporary text-only brand lockup when ACCO supplies an approved logo asset and brand usage rules.

final result: passed
