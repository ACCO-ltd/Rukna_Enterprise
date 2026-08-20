---
Status: accepted
---

# ACCO Authority Matrix: Delegation of Authority, Segregation of Duties, and roles

## Status note

Domain-approved by **Eng Ahmed Shirie (CEO, ACCO Ltd)** on 2026-08-17. This ADR **activates and
completes** the previously-parked DOA + value-threshold + SoD machinery (`SegregationOfDutiesService`,
`WorkflowStep`, threshold routing) — it is now confirmed *required*, not deletable. Two config
items remain open and do **not** block this ADR: **(D)** the numeric bill-match / over-receipt
tolerances (ADR-018 seed values) and **(E)** the A12 settlement-ledger question.

## Context

The audit found the DOA/SoD subsystem armed but not wired, and flagged it as possible over-build.
Eng Ahmed confirmed ACCO's real authority model — explicit value thresholds, explicit segregation
of duties, and named approval chains — so the subsystem is justified and must be completed. ACCO's
titles also collapse: several proposed roles are the same job at different scope.

## Decision

### CONST-DOA-001 — Roles (consolidated to ACCO reality)

**Org-scoped (all projects):**
- **Construction Director** — full access to all projects; the org-wide project authority (the
  "how is every project going" role). **Owns BOQ scope + cost estimate (replaces a separate QS).**
  Recommends project Start and completion certification. Acts as **Construction's "Department Head"**
  for procurement (see thresholds). No separate monetary matrix beyond the Department-Head bands.
- **CFO** — procurement $1,000.01–$50,000; payment authority; budget/commercial confirmation;
  journal approver.
- **Group CEO** — final Start approval; final closure; >$50k; **absorbs Legal/Compliance** review.
- **Board / Chairman** — >$50k.
- **Finance Manager / Finance Officer** and **Accountant** — Finance confirmation, budgets, final
  account, AP/AR certification, journal preparation. Finance participates through the construction gates.
- **System Administrator** — no business-transaction approval authority.

> **Finance ladder confirmed 2026-08-20:** the finance hierarchy is **Accountant → Finance Officer
> → CFO** (three tiers). Where this ADR writes "Finance Manager" (e.g. the payment ≤ $1,000 tier),
> read **Finance Officer**. There is no separate Finance-Manager role above the Finance Officer.

**Project-scoped (per project; chain configurable):**
- **Site Engineer** — prepares DPRs, enters progress, raises MRs (requester), takes site decisions.
- **Project Manager** — the single project-level authority (ACCO treats *Project Engineer /
  Project Manager / Project Coordinator as one role*). Reviews & approves DPRs; recommends Start;
  confirms Closeout deliverables. The Construction Director is the org-wide equivalent — not a
  separate layer.

**Procurement & Stores:**
- **Procurement Officer** — creates MR→PO, runs procurement; **also holds Store Keeper access**.
- **Store Keeper** — goods receipt / stores.

### CONST-DOA-002 — Access ≠ authority (the safety rule, applied twice)
A broad access grant never bypasses SoD.
- The Procurement Officer's Store-Keeper access does not let a PO creator freely receive goods —
  overlap triggers the controlled exception (CONST-DOA-004).
- The Construction Director's all-projects access does not let him approve his own requests.

### CONST-DOA-003 — Segregation of Duties (mandatory)
The following must be different people:
Requester ≠ own MR/PO approver · PO creator ≠ goods receiver · Goods receiver ≠ bill approver ·
Bill approver ≠ payment approver/releaser · Vendor maintainer ≠ PO/payment processor ·
Journal preparer ≠ journal approver · System administrator ≠ business-transaction approver.

### CONST-DOA-004 — The one controlled exception
A PO creator may temporarily also receive goods where staffing requires it, **only** if an
independent supervisor verifies receipt **and** the CFO approves the documented exception.

### CONST-DOA-005 — Thresholds are per-command (not one global ladder)

**Purchase Orders / Procurement:**
| Band | Authority |
|---|---|
| ≤ $100 | Department Head (= Construction Director) **or** Project Manager |
| $100.01 – $1,000 | Department Head + Finance confirmation |
| $1,000.01 – $50,000 | CFO *(merged band — no separate control at $10k for POs)* |
| > $50,000 | CFO + Board Chairman + Group CEO |

**Supplier Payments:**
| Band | Authority |
|---|---|
| ≤ $1,000 | Finance Manager (after operational/AP certification) |
| $1,000.01 – $10,000 | CFO |
| > $10,000 | CFO + Group CEO |

**Payment release** additionally requires **at least two authorized bank signatories** and SoD —
release is a distinct dual control from payment *approval*.

### CONST-DOA-006 — Project Start approval chain (DRAFT → ACTIVE)
Project Manager / Construction Director **recommends** → CFO confirms budget, funding & commercial
viability → Group CEO **final approval** (CEO also covers contract/obligations; no separate Legal
step). Board when delegated authority requires.

### CONST-DOA-007 — Project Closeout → Closed chain
Project Manager confirms deliverables + defects → Finance confirms final account, AR/AP, retention,
asset transfer → Internal Audit/Control may review → Group CEO **final closure approval**.

### CONST-DOA-008 — DPR approval chain
Site Engineer **prepares** → Project Manager **approves** (ACCO's Project Engineer/Manager are one
role). Configurable per project/organization.

### CONST-DOA-009 — BOQ baseline is preparer ≠ sole approver
Because the Construction Director prepares BOQ scope + cost, he cannot solely approve the baseline.
Baselining is a **controlled gate of the Start-project chain** (CONST-DOA-006): technical
preparation/recommendation → CFO budget/commercial confirmation → CEO final authorization →
baseline. *(Engineering recommendation consistent with ACCO governance, not an explicit ACCO
BOQ-baseline rule.)*

## Consequences
- **Completes** the DOA/threshold/SoD subsystem (`SegregationOfDutiesService`, `WorkflowStep`,
  value-threshold routing) — schedule its implementation; it is no longer "parked/deletable."
- Per-command threshold configuration (POs merge the $10k band; payments preserve it) — the engine
  must support command-scoped ladders, not one global matrix.
- Bank-signatory dual-control on payment release is a new control to build alongside payment approval.
- Roles map onto existing org-membership + project-membership + the Project Access Scope Resolver
  (ADR-009). Access scope and approval authority are separate axes.
- Ratifies the domain rules of ADR-018/019/020/021 (accepted). Open: tolerance values (D),
  settlement ledger (E).
