# ADR-028: Domain Workspaces and Navigation Depth

**Status:** ACCEPTED  
**Date:** 2026-09-08  
**Decision owners:** Abdulsalam (Frontend / Platform)  
**Refines:** ADR-027 GOV-ADM-001 (which fixed Administration's information architecture but left it
drawn as a sidebar column)

## Context

The global sidebar had begun to grow a second level. Administration held six rows sorted under four
micro-labels — People, Organization, Governance, Evidence — expanding inside the sidebar. It worked,
and it was still the wrong shape: it put a second level of navigation permanently in the chrome of
**every** screen in the product in order to serve six screens that a person visits deliberately, a
handful of times a week. Procurement was on the same path, with a "Setup" group of five.

The product had already answered this question once, in a place nobody had generalised from. A
project is not eight sidebar rows; it is a workspace with eight tabs, entered from one sidebar row.
Two solutions to one problem existed side by side, and they had already drifted: the two tab bars
disagreed on height, horizontal padding and font weight, and — worse — on what to do when the
viewport is too narrow to hold them. One collapsed to a picker; the other scrolled sideways and left
its later tabs off-screen with nothing indicating they existed.

## Decision

### NAV-001 — A domain of deliberately-visited screens is a workspace, not a sidebar column

A domain whose destinations serve one job and are visited deliberately renders as **one sidebar row**
(`flat: true` on the domain in `nav-groups.ts`): no chevron, no child rows, no collapsed-sidebar
flyout. Clicking it opens the domain's workspace, and its destinations are that workspace's tabs.

The row stays lit for every route beneath the domain. Something has to say "you are in
Administration" once the child rows that used to say it are gone.

This applies to Administration today. It is the shape to reach for when any domain's sidebar
children start to need labels to explain themselves.

### NAV-002 — The workspace owns the `h1`; its screens are `h2`

A screen inside a workspace must not announce itself as the top of the document. The workspace is the
`h1` and each screen is an `h2` within it, carrying its own one-line description and its own primary
action in the same header row. Before this, "Users" was the `h1` of the page with nothing above it
saying which part of the product it belonged to.

### NAV-003 — One tab bar: `WorkspaceTabs`

There is a single component for a workspace's tab bar, used by the project workspaces and by
Administration alike. It owns the desktop row, the active styling, the focus ring, and one answer to
narrow viewports: **below `md` the tabs become a picker**, because at 375px that is the honest
control — every destination is reachable and the current one is named, where a scrolling row hides
both facts.

Hosts supply only what genuinely differs: which edge carries the rule, and the picker's own inset.

### NAV-004 — `nav-groups.ts` stays the single source of destinations

Routes, labels, icons and permission gates are declared once. Three consumers read that declaration:
the sidebar's active state, the command menu, and the workspace's tab bar. A `flat` domain's items
still live there — they are simply drawn somewhere else. A `groupKey` on a flat domain draws nothing
and survives as a record of the jobs the workspace does, and as the tab order.

### NAV-005 — A breadcrumb must carry information the screen does not

Keep a trail whose middle crumb names a specific record — a project workspace's
`Projects › Hodan District Office Tower › BOQ` earns its line. Drop a trail that restates the sidebar
row, the `h1` and the lit tab, as `Dashboard › Administration › Users` did; its middle crumb pointed
at `/admin`, which redirects to `/admin/users`, so on the first tab it linked to the page the reader
was standing on.

For the same reason a workspace header carries no fixed subtitle. One sentence repeated on every
screen of the workspace is a cost paid on every visit; the per-screen description says something that
differs.

### NAV-006 — A route beneath a tab renders bare

A route that sits *under* a tab rather than on one — today the governance builder at
`/admin/workflows/[policyId]` — is a workspace in its own right, with its own header and its own tab
bar. The parent workspace's chrome gets out of the way: two stacked tab bars is not a hierarchy a
reader can parse. This is decided against the tab list (`isAdminDeepRoute`), not against a named
route, so the next deep route inherits the behaviour instead of rediscovering the bug.

## Consequences

- The sidebar is one level deep for flat domains, and every screen in the product gets that column
  of chrome back.
- Administration's six screens each recover roughly 55px above the fold — a row and a half of the
  table the reader came to read.
- The two tab bars cannot drift apart again; a change to workspace navigation is made once.
- Procurement's "Setup" group is now the remaining second level in the sidebar. It is **not**
  converted here — that is a separate decision with its own IA questions, and this ADR does not
  pre-judge it.
- Deferred Administration destinations (access reviews, a standalone SoD registry) stay absent until
  they have a backend. A tab that 404s is worse than one documented as deferred.

## Alternatives considered

**Keep the grouped sidebar column.** Rejected: it charges every screen in the product for navigation
that six screens need, and the micro-labels were themselves evidence that the list had outgrown the
sidebar.

**Scroll the tab bar horizontally on narrow screens.** Rejected: tabs beyond the fold have no
affordance saying they exist, and landing on the last tab scrolls the lit one out of view. It would
also have been a second idiom for a problem the product had already solved.

**Give Administration an overview landing page.** Rejected for now: `/admin` redirects to
`/admin/users`. There is no aggregate worth showing that the six screens do not show better, and a
landing page would add a click to every visit.
