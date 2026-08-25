# Round 2 — Stage 1 Audit: Shell + Dashboard

Status: Findings (pre-proposal). Method: heuristic grill against `ux-doctrine.md` + Nielsen
heuristics, grounded in the actual components (not the stale doc). Live browser capture pending the
running dev environment — annotated below where empirical confirmation is still owed.

Scope: global shell (`components/layout/app-shell`, `global-sidebar`, `top-bar`), the `/dashboard`
page (`features/dashboard/*`), and the shared patterns everything inherits (status tokens, KPI card,
widget shell).

Severity: **S1** blocks the goal (enterprise/zero-training/not-messy) · **S2** meaningful friction ·
**S3** polish. Each finding names the *decision behind it*, per the grill method.

---

## Verdict up front

The shell is **well-engineered and close to right** — collapse-to-rail, flyouts, skip-link, failure
isolation, and a mature token layer are all here. The gaps are not craft; they are **composition and
honesty**: the dashboard doesn't answer "what needs me?", a few surfaces carry decorative or dead
weight, and two "coming soon" stubs violate the honesty rule. Fixing the shell+dashboard well sets
the pattern every downstream screen inherits.

---

## Dashboard

| # | Sev | Finding | Decision behind it | Direction |
|---|---|---|---|---|
| D1 | **S1** | The dashboard answers "how many projects?" not "**what needs me now?**". Five count KPIs + a recent-projects table + "view all". No action queue, no exceptions, no approvals-waiting, no financial position. For a CEO/PM/accountant this is a report, not a command center. | Built before the attention feed existed; counts were the only data available. | Re-shape into: metric **strip** → "requires your action" queue → recent activity. Queue needs `GET /attention-items` (§6 doctrine) — the one gating backend ask. Until then, ship strip + portfolio table honestly (no fake queue). |
| D2 | S2 | Five bordered `KpiCard` boxes in a grid — the "card around everything" pattern the doctrine calls the main source of mess. | Old `frontend-design.md` prescribed a KPI card grid. | Convert to a hairline-separated **metric strip** (§2.2). Cards only if a metric owns clickable sub-content. |
| D3 | S2 | "Role-adapted home screen" (per old plan) but every role sees the same five portfolio counts. An accountant and a site engineer get identical, mostly-irrelevant numbers. | Role adaptation was never built. | Drive the strip + queue off the user's permissions/role once the attention feed exists; scope metrics to what that role acts on. |
| D4 | S3 | Good failure isolation (client KPI renders even if projects fetch fails), skeleton, and empty state already present. | — | **Keep.** This is the standard for every slice's DoD. |

## Global sidebar

| # | Sev | Finding | Decision behind it | Direction |
|---|---|---|---|---|
| N1 | **S1** | No **command menu (⌘K)**. For zero-training, "press ⌘K, type what you want" is the highest-leverage affordance — and jump-to-navigation needs *no backend*. | Global search was (correctly) removed pending `GET /search`; but navigation ≠ search, and got removed with it. | Add a client-side ⌘K palette that navigates the existing nav map now; fold in record search later when the endpoint lands. |
| N2 | S2 | Inconsistent active-state treatment: the standalone Dashboard link active = **filled** `brand-primary`; domain items active = **tinted** `brand-accent`. Two different "you are here" signals. | Grew incrementally. | Codify one active pattern (doctrine §1: neutral/tinted fill + accent edge). Pick one, apply everywhere. |
| N3 | S2 | The **help card** (Lifebuoy "helpTitle/helpDescription") is a decorative sidebar card occupying permanent vertical space with no live job. Doctrine §7 forbids decorative sidebar cards. | Filler for empty sidebar space. | Remove, or replace with a functional element (e.g. a real support/command-menu entry). |
| N4 | S3 | Dead code: `NavIcon` has `const useProfessionalIcons = true` (always) guarding a ~140-line hand-rolled SVG switch that never renders. Divergent-change / dead-code smell. | Migration from hand-rolled to Phosphor icons left the old branch in place. | Delete the dead branch and the `useProfessionalIcons` flag. |
| N5 | S3 | `RTL`/`rtl:` layout logic throughout the sidebar (flyout translate, chevron rotate). | Built when the app was bilingual. | Arabic is removed (§3). RTL handling is now dead complexity — schedule removal (broad, do as its own pass, not inline). |

## Top bar

| # | Sev | Finding | Decision behind it | Direction |
|---|---|---|---|---|
| T1 | **S1** | The **attention bell is a permanently disabled stub** — the exact "disabled control advertises an unbuilt feature" anti-pattern the team *correctly* removed for search, kept for the bell. Inconsistent honesty. | Placeholder for the unbuilt `GET /attention-items`. | Remove the bell until the endpoint exists (doctrine §4). It returns *with* the dashboard action queue (D1), as one backend dependency. |
| T2 | S2 | The top bar is nearly empty: hamburger (mobile) + a flex spacer + bell stub + theme toggle + account menu. On desktop it's a tall (68px) mostly-blank bar. | Search removed, nothing put in its place. | Give it a job: ⌘K search entry (N1) as the leading affordance; context/breadcrumb slot when in a workspace. |
| T3 | S3 | Theme toggle appears both in the top bar and (per theme doc) the account menu. | Convenience quick-toggle. | Acceptable, but decide one home; a quick-toggle is fine if the account-menu duplicate is intentional. |

## Cross-cutting / doctrine

| # | Sev | Finding | Direction |
|---|---|---|---|
| X1 | **S1** | `frontend-design.md` (marked CANONICAL) prescribes removed features: Exchange Rates, 8-state lifecycle, IPC FX fields, mandatory en/ar. Any agent following it builds the wrong thing. | Superseded by `ux-doctrine.md`; deprecation banner added. Screen-level build notes kept. |
| X2 | S2 | `apps/web/CLAUDE.md` carries two stale mandatory rules: the backend/frontend boundary (user now directs the frontend) and "MANDATORY bilingual en+ar RTL" (Arabic removed). | Both corrected this stage. |
| X3 | S2 | Two "coming soon" stubs resolved opposite ways (search removed, bell kept). | Unify under doctrine §4 as one rule. |

---

## Sequenced fixes for the Shell+Dashboard slice (Stage 2 will wireframe these)

1. **Dashboard reshape** (D1/D2/D3) — metric strip + action queue + activity. *Backend-gated on the
   attention feed; ships in honest interim form first.*
2. **Command menu ⌘K** (N1/T2) — client-side navigation palette. No backend. High zero-training win.
3. **Honesty pass** (T1/N3/X3) — remove the bell stub and the help card; one rule for unbuilt features.
4. **Active-state unification** (N2) — one "you are here" treatment.
5. **Dead-weight removal** (N4/N5) — dead icon branch now; RTL removal as its own broad pass.

The **backend request** (attention feed) should be filed now so it's ready when the dashboard reshape
lands — it's the only thing on the critical path we don't already have.
