# Phase 3B visual design QA — Contracts and certification

## Evidence

- Source visual truth: approved Modern Rukna command direction and uploaded Rukna design-system references.
- Implementation routes: `/contracts`, `/contracts/new`, `/contracts/[id]`, IPA detail, IPC detail, and IPC issue wizard.
- Expected viewport: desktop application shell at 1536 CSS pixels wide, device scale factor 1.
- State: authenticated ACCO tenant, English locale, contract and certification records where available.

## Implemented comparison surfaces

- Contract list filters and commercial table.
- Contract create/edit grouped form sections.
- Contract document header, commercial overview, terms tabs, guarantees, milestones, and applications container.
- IPA and IPC document headers and financial KPI strips.
- Approval decision panel.
- IPC issue wizard frame and step surfaces.

## Findings

- Browser-rendered implementation evidence is unavailable in the current tool session. The code compiles, production build passes, and focused interaction tests pass, but the Product Design QA gate requires a browser screenshot, interaction check, console check, and direct visual comparison against the selected source.

## Validation completed

- TypeScript type check: passed.
- Production Next.js build: passed.
- Focused Contract, IPA, IPC, workflow, and wizard tests: 183 passed.
- No application behavior, routes, APIs, permissions, or workflow transitions were intentionally changed.

## Next QA action

- Open the authenticated application in the selected in-app browser.
- Capture Contract list, Contract form, Contract detail, IPA detail, IPC detail, and IPC wizard at the expected desktop viewport.
- Check primary navigation/actions and browser console.
- Compare the implementation captures with the approved Rukna reference and fix any P0/P1/P2 differences.

final result: blocked
