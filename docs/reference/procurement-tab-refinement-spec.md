# Procurement tab — refinement spec

Status: **Backend largely built (INTEGRATED, org-level). Refinement = a project-scoped surface +
ADR wiring.** Owners: Backend — Abdulsalam · Frontend — frontend engineer.
Source of truth: ADR-020 (BOQ backbone + change classifier), ADR-022 (DOA + SoD + roles), ADR-018
(bill matching), ADR-013 (Project Financial Position).

## Purpose

Procurement (MR → PO → GRN → Bill match → Commitment Ledger) is `INTEGRATED` but lives **org-level**
(`/procurement/*`). The data already supports project scoping (`MaterialRequest.requestScope =
PROJECT | ORGANIZATION`, `projectId`, and `boqNodeId` on lines) — there is just **no project-workspace
Procurement tab**. This adds one, and wires the confirmed ADR decisions.

## Two homes (clear boundary)
- **Org-level `/procurement/*` (keep):** master data (UoM, materials, categories, **suppliers**), the
  buyer's cross-project queue, `ORGANIZATION`-scope buying (central/warehouse stock).
- **Project Procurement tab (new):** *this project's* MRs / POs / GRNs / commitments + cost. A
  `PROJECT`-scope MR appears here; an `ORGANIZATION` MR appears org-level. Mostly a **project-filtered
  read** over existing services (`projectId`), plus the cost summary.

## What the project tab does
1. **BOQ-linked cost spine (ADR-020 / ADR-013):** lines carry `boqNodeId`; the Commitment Ledger
   (`COMMITTED → ACCRUED → ACTUAL`) rolls up **per BOQ node → Project Financial Position**. The tab
   leads with `Committed / Accrued / Actual`.
2. **"Raise requirement" = the ADR-020 classifier**, not a raw "+ New MR". A site need routes:
   *Resource for existing BOQ work* → MR linked to the BOQ node · *New/changed client scope* →
   Variation (Sprint 6) · *Internal omission / unplanned* → non-recoverable project cost. Preserves
   the **cost↔revenue firewall** (ADR-018/020/021): a new cost never auto-becomes client revenue.
3. **Approvals route through ADR-022 DOA:** thresholds (≤$100 Dept Head = Construction Director ·
   $100.01–1,000 + Finance · $1,000.01–50,000 CFO · >$50,000 CFO+Board+CEO) + **SoD** (requester ≠
   MR/PO approver; PO creator ≠ goods receiver, with the controlled supervisor-verify + CFO-approved
   exception). Activates the parked threshold/SoD machinery on the procurement commands.
4. **Roles (ADR-022):** Site Engineer *raises* MRs (requester); **Procurement Officer** creates PO
   (holds Store Keeper access, still SoD-bound); **Store Keeper** receives goods.
5. **Bill matching (ADR-018):** the corrective invariants apply — 3-way using the GRN, a tolerance
   gate that actually **blocks** out-of-tolerance, structured exception reasons, cumulative matching.

## Layout
```
PROCUREMENT — Al-Baraka        Committed $X · Accrued $Y · Actual $Z  → Financial Position

[ Raise requirement ]  → classifier (resource for BOQ · variation · internal)

Material Requests  (this project)   status · BOQ node · approval
Purchase Orders                     committed · revisions
Goods Receipts                      received/accepted · exceptions
Commitments                         COMMITTED → ACCRUED → ACTUAL per BOQ node
```

## The honest open loop
Procurement reaches `ACCRUED`/`ACTUAL`, but **"issue material to site = project consumption/cost"
needs Inventory (Sprint 7, not built).** The tab shows committed/accrued/actual today; the
consumption→cost step lights up with Inventory. Flagged, not solved here.

## Sequence
1. **Project-scoped read models / filters** (`projectId`) for MR/PO/GRN/Commitments + the
   committed/accrued/actual summary → the Procurement tab UI.
2. **Wire ADR-022 DOA** (thresholds + SoD) onto the MR/PO commands — part of the DOA/SoD build.
3. **"Raise requirement" classifier** entry — shares the ADR-020 unplanned-requirement router
   (Sprint 6/7 branches).
4. **ADR-018 matching corrections** (separate accepted work).
