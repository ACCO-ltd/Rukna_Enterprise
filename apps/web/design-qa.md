**Design QA**

- Source visual truth: `C:\Users\cshii\Downloads\ChatGPT Image Aug 14, 2026, 08_10_59 PM.png`
- Intended implementation: Rukna Commercial workspace at `/projects/:id/commercial`
- Reference pixels: 1536 x 768
- Intended CSS viewports: 1440 x 900 desktop and 375 x 812 mobile, device scale factor 1
- State: authenticated project with an active client contract and payment applications

**Findings**

- [P1] Browser-rendered comparison is blocked by missing test authentication.
  Evidence: Playwright global setup stopped with `Demo password is required. Set RUKNA_DEMO_PASSWORD` before navigation.
  Impact: the reference and a fresh implementation screenshot cannot be placed into the required visual comparison.
  Fix: provide `RUKNA_DEMO_PASSWORD`, rerun `commercial-mobile.spec.ts`, capture desktop and mobile states, and compare those captures with the source board.

**Source-Level Review**

- Information architecture now matches the selected reference: Overview, Contract & Security, Applications & Certification, Billing & Collection.
- The header, five-metric band, payment-cycle progress, compact exception treatment and data-first tables follow the selected composition.
- Existing Rukna semantic colors, typography, radii, dark mode and RTL infrastructure are preserved.
- Old Commercial URLs redirect to the new canonical sections.
- No raster assets are required by the reference; all visible imagery is standard interface iconography and uses Lucide.

**Implementation Checklist**

- Supply the demo password to Playwright.
- Capture the four Commercial sections at desktop and mobile in English light, English dark, Arabic light and Arabic dark.
- Compare the source and implementation at equal scale.
- Fix any visible P0/P1/P2 typography, density, spacing, overflow or contrast differences.

**Follow-up Polish**

- Validate the payment-cycle stage projection against real mixed IPA/IPC/invoice states.
- Confirm the compact table density with a high-volume project.

final result: blocked
