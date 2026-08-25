# Round 2 — Stage 2 Wireframes: Shell + Dashboard

Status: **Low-fidelity, for review before implementation.** These are structure/behaviour, not
pixels — colour, exact spacing, and copy are governed by `ux-doctrine.md` + `frontend-theme.md`
tokens. Nothing here changes the token layer or the Rukna brand colours.

Traces to: `round2-audit-shell-dashboard.md` findings (D1–D4, N1–N5, T1–T3). Each wireframe notes
which findings it resolves.

Legend: `▸` collapsed · `▾` expanded · `◆` accent (interactive/primary) · `●` status dot ·
`[ ]` control · `·····` hairline rule · `▓` skeleton.

---

## 1. Desktop application shell

Resolves N2 (one active-state), N3 (drop help card), T1 (drop bell stub), T2 (top bar gets a job:
⌘K), N1 (command menu entry).

```
┌────────────────────────┬─────────────────────────────────────────────────────────────┐
│ ◆R  Rukna ERP          │  [⌘K  Search or jump to…            ⌘K]        ● AS  Amir ▾  │ ← top bar 56px
│     ACCO               ·································································│   (was 68px)
│ ────────────────────── │                                                             │
│  ▸ Dashboard           │   Page title                                                │
│                        │   ·········································· (SectionHeader) │
│  ▾ Projects        ◆   │                                                             │
│      Clients           │   ‹ page content, max-w 1440, 24px gutter ›                 │
│    ● Projects      ◆   │ ← active item: tinted fill + 2px accent edge (ONE pattern)   │
│  ▸ Accounting          │                                                             │
│  ▸ Procurement         │                                                             │
│  ▸ Administration      │                                                             │
│                        │                                                             │
│  (nav scrolls)         │                                                             │
│ ────────────────────── │                                                             │
│  AS  Amir Salah        │ ← user footer stays                                         │
│      ACCO · Admin      │                                                             │
└────────────────────────┴─────────────────────────────────────────────────────────────┘
   240px, collapse→64px rail                     content column
```

Changes from today:
- **Top bar** drops the disabled bell (T1) and the empty flex spacer; gains a **⌘K search/jump
  affordance** as its leading element (T2/N1). Height trimmed 68→56px (denser, enterprise).
- **Sidebar** drops the decorative Lifebuoy help card (N3). Command menu is reachable from the ⌘K
  chip *and* a keyboard shortcut anywhere.
- **One active-state treatment** everywhere (N2): tinted `brand-accent` fill + a 2px `brand-primary`
  leading edge. The Dashboard link stops being a filled-blue exception.
- Theme toggle moves into the account menu (▾) — one home (T3). Top-bar real estate goes to ⌘K.
- The attention/notification indicator returns to the top bar **only when** `GET /attention-items`
  ships (T1 + D1) — as a live count badge, never a disabled stub.

Collapsed rail (64px): icon-only nav with hover flyouts (already built, kept); ⌘K still available via
shortcut; brand mark + user avatar only.

---

## 2. Command menu (⌘K) — the zero-training centrepiece (N1)

Pure client-side navigation now; record search folds in when a search endpoint exists. Opens on ⌘K /
Ctrl-K or the top-bar chip.

```
        ┌──────────────────────────────────────────────────────────┐
        │ ⌕  new certificate|                                       │ ← type-ahead
        ├──────────────────────────────────────────────────────────┤
        │  GO TO                                                     │ ← micro-label section
        │   ▸ Projects                                        ↵      │
        │   ▸ Accounting › Client invoices                   ↵      │
        │   ▸ Procurement › Purchase orders                  ↵      │
        │  ACTIONS                                                   │
        │   ◆ Create project                                 ↵      │
        │   ◆ New material request                           ↵      │
        │  ─────────────────────────────────────────────────────    │
        │  RECORDS   (enabled when GET /search lands — hidden now)  │
        └──────────────────────────────────────────────────────────┘
          ↑↓ navigate · ↵ open · esc close
```

- Sources today: the existing `NAV_DOMAINS` map (every destination) + a registry of primary create
  actions the user has permission for. No backend.
- Permission-filtered: only shows what `can()` / `moduleVisible()` allow — same gate as the sidebar.
- Honesty (§4 doctrine): the RECORDS group is **absent**, not a disabled tease, until search exists.

---

## 3. Dashboard — from report to command center (D1, D2, D3)

Two versions. **3a is what we can ship immediately** (pure frontend, honest). **3b is the target**
once the attention feed lands. Same skeleton — the queue slots in where the interim shows a portfolio
table.

### 3a. Interim (ships now — no backend dependency)

```
  Dashboard
  ·······················································································
  PORTFOLIO                                                                              ← micro-label
   Total        Active        In preparation     Finished        Clients
   128          94            22                 12              37                       ← metric strip:
   ────────── │ ────────── │ ──────────────── │ ────────── │ ──────────                    tabular, hairline
              (each metric links to its filtered list)                                     dividers, NO cards

  RECENT PROJECTS                                                          [ View all → ]
  ·······················································································
   CODE            NAME                    CLIENT           ● STATUS        UPDATED
   ACCO-WBR-26-01  Ring Road Phase 2       Baraka Real Est  ● Active        Today, 08:02
   ACCO-BND-26-07  Warehouse Fit-out       …               ● Preparation   Yesterday
   …                                                                        (portfolio table, reused)
```

Resolves D2 (KPI cards → metric strip) and keeps the good recent-projects table. Honest: no fake
"action" queue when there's no feed to populate it.

### 3b. Target command center (when `GET /attention-items` ships — D1, D3)

```
  Dashboard                                                        Tue 25 Aug, 09:14
  ·······················································································
   Requires you   Overdue      Cash in (30d)     Certified (MTD)    Active projects
   7              3            412,800.00 USD    1,240,000.00 USD   94                  ← role-scoped
   ────────── │ ────────── │ ───────────────── │ ───────────────── │ ──────────           metric strip

  REQUIRES YOUR ACTION   (7)                                                            ← the point of the page
  ·······················································································
   ● IPA-0031 awaiting your approval        Ring Road Phase 2    3 days ago    [ Review → ]
   ● Guarantee expiring in 6 days           Warehouse Fit-out    —             [ Open → ]
   ● Period Jul-26 ready to close           Accounting           —             [ Close gate → ]
   … (prioritised by severity: URGENT ● danger, WARNING ● warning, INFO ● neutral)
                                                                             [ View all (7) → ]

  EXCEPTIONS  (2)                                RECENT ACTIVITY
  ·····································          ·····································
   ● AP reconciliation variance 2,500          IPC-0088 issued · Amir · 08:02
   ● PO-2214 over-received                      Receipt posted  · Sara · Today 07:40
                                                Contract executed · … · Yesterday
```

- **Role-scoped** (D3): the metric strip and the queue reflect what *this* user acts on — an
  accountant sees period/AR items, a PM sees approvals/guarantees. Driven by permissions + the feed's
  per-item `category`.
- Queue items map 1:1 to the `attention-items` response shape already specced (severity, category,
  title, description, actionUrl). Each row's button deep-links to the record.
- Metric strip carries **money in tabular neutral** with currency suffix (doctrine §3) — never
  coloured. Severity lives on the `●` dot, not the figure.

---

## 4. Mobile — 375px (DoD #2)

```
┌───────────────────────────┐     Command menu (⌘K → full-screen sheet on mobile):
│ ☰   Rukna ERP      AS ▾   │ ← 56px  ┌───────────────────────────┐
│ ─────────────────────────  │        │ ⌕ Search or jump…     ✕  │
│  Dashboard                 │        ├───────────────────────────┤
│  ·························   │        │ GO TO / ACTIONS …         │
│  Requires you        7  →  │        └───────────────────────────┘
│  Overdue             3  →  │
│  Cash in (30d)             │     Metric strip → stacks to a 2-col grid of
│  412,800.00 USD            │     label/value rows (still hairline-separated,
│  ·························   │     still not cards). Queue rows are full-width,
│  REQUIRES YOUR ACTION      │     button becomes a chevron-tap on the whole row.
│  ● IPA-0031 · approve   →  │
│  ● Guarantee 6d         →  │     ☰ opens the existing nav drawer (built).
│  ·························   │     Touch targets ≥ 44px throughout.
│  [ View all (7)         → ]│
└───────────────────────────┘
```

---

## 5. Component inventory (for Stage 3 build planning)

| Component | Status | Notes |
|---|---|---|
| `MetricStrip` + `Metric` | **new** | Replaces `KpiCard` grid on dashboard; hairline dividers, tabular value, optional link. Reusable on project Overview + reports. |
| `CommandMenu` (⌘K) | **new** | Client-side nav+action registry, permission-filtered. Radix Dialog + list. No backend. |
| `ActionQueue` + `ActionItem` | **new** | Consumes `attention-items`; severity dot + title + context + deep-link. Portfolio and project-scoped variants. |
| `ActivityFeed` | reuse/extend | Exists in project workspace (`commercial-activity`); generalise. |
| `KpiCard` | **retire** on dashboard | Kept only where a metric genuinely owns clickable sub-content. |
| Sidebar help card | **remove** | N3. |
| Top-bar bell stub | **remove** | T1 — returns as live `AttentionIndicator` with the feed. |
| Dead `NavIcon` SVG branch + `useProfessionalIcons` | **remove** | N4. |
| `rtl:` / `dir` sidebar logic | remove (separate pass) | N5 — its own PR, not inline. |
| Active-nav treatment | **unify** | N2 — one `NavLink` active style, used by standalone + domain items. |

Everything else in the shell (collapse store, flyouts, skip link, drawer, failure isolation,
skeleton, empty states, token usage) is **kept as-is** — it already meets the doctrine.

---

## 6. Build sequencing (Stage 3 — proposed, pending your review of these wireframes)

1. **Shell honesty + ⌘K** (§1, §2) — pure frontend, no backend. Ships the biggest zero-training win
   and removes the two stubs. *One PR.*
2. **Dashboard interim reshape** (§3a) — metric strip + reused table. Pure frontend. *One PR.*
3. **Dead-weight removal** (N4 now; N5 RTL as its own pass). *Folded into 1–2 or a small PR.*
4. **Dashboard command center** (§3b) — **gated on the backend attention feed** (filed as a backend
   request). Lands when the feed is ready; until then §3a stands honestly.

Open questions for you before Stage 3:
- **Metric strip vs. keeping cards** — confirm you want the calmer strip (my recommendation), or
  prefer to keep tappable cards on mobile.
- **⌘K scope** — nav + create-actions now, or hold ⌘K entirely until record-search backend exists?
  (I recommend shipping the nav/action palette now; it stands on its own.)
