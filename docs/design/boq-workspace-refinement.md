# BOQ Workspace — refinement proposal (for review)

**Status:** proposal, not decided. **Author:** product/eng, acting as construction director + product designer.
**Scope:** the BOQ tab experience end-to-end — first run, adding/importing, editing, numbering, an
audit trail, state naming, and how variations connect. No code changed yet.

---

## 1. What exists today (audited from the code, so we refine reality)

| Area | Today |
|---|---|
| Entry | `/projects/[id]/boq` → `BoqWorkspace`. One read-model query (`GET /boq/workspace`). |
| First run | Empty state offers **one** button: **"Initialize"** (jargon). Import is *not* offered here. |
| States | `DRAFT` / `BASELINED` shown as raw status badges. |
| Actions | Split awkwardly: the contextual **Next-step** button + **Add section** (toolbar, outline) + **Import** and **Export** (in a `⋯` overflow). "Add item" only appears as a per-row menu item. |
| Grid | `<Table role=grid>`; each row's actions live in a `⋯` **row menu** (Edit / Add item / Add section / Delete / Move). Clicking a row opens the **edit dialog**. |
| Editing | Everything — even changing one rate — goes through a **centered 7-field dialog** (`BoqItemDrawer`). No inline editing. |
| Code entry | An **editable text box**, pre-filled with a proposed code (`suggestNodeCode`) but still free-typed; uniqueness enforced only on save (`400`). |
| History | **None per-line.** Change is visible only by **comparing two versions** (Compare panel). |
| Versions | New version per **revision** (post-baseline). Draft is edited in place (good). |
| Variations | Backend: full lifecycle (`create → lines → submit → internal/client-approve → apply-to-boq → adopt-baseline`, + EOT + at-risk). Frontend: **exists under Commercial** (`VariationsTab` + create/detail dialogs) — **not linked from the BOQ tab**. BOQ nodes already carry `sourceType = VARIATION` + `sourceChangeOrderId`. |

**Reading of the problems** (yours, confirmed by the audit):
1. First run hides the most common start (Import) behind a jargon button.
2. The essential *creative* actions (Add item, Add section, Import) are scattered / partly hidden.
3. A modal for every edit is heavy — a QS repricing 200 lines opens 200 dialogs.
4. The code box is a blank-ish field on the one value that must be unique and conventional.
5. No plain "who changed what, and what was it before" — only version diffs.
6. `DRAFT`/`BASELINED` are our words, not the team's.
7. Variations aren't connected to the BOQ, so "how do I add a line after signing?" has no visible answer here.

---

## 2. The model we're refining toward (agreed in discussion)

> **Working BOQ** (one living, edited-in-place document, with a per-line **history log**) → *freeze at
> contract signature* → **Contract BOQ** (immutable) → post-signature change = **Variation Orders**
> layered on top (already built; to be connected + clarified).

This keeps one editable document (no version spam), one meaningful freeze, and routes real change to
variations — matching construction practice and protecting the money already attached to line codes
(certificates, POs, cost ledger all reference a node by its code).

---

## 3. The refinements

### 3.1 First run — two clear doors, no jargon
Replace the single **Initialize** button with the two real ways to start, both obvious:

```
┌─────────────────────────────────────────────────────────────┐
│  This project has no Bill of Quantities yet.                 │
│  Bring in your priced bill, or start from scratch.           │
│                                                              │
│   ┌───────────────────────────┐  ┌────────────────────────┐ │
│   │  ▣  Import from a          │  │  ＋ Start a blank BOQ  │ │
│   │      spreadsheet           │  │                        │ │
│   │  Excel / CSV → map → review│  │  Add sections & items  │ │
│   │           [ Import ]       │  │        [ Start ]       │ │
│   └───────────────────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```
- **Import** is the visual primary (most BOQs arrive as Excel). It already creates the BOQ+draft itself.
- **Start blank** creates the empty Working BOQ and immediately opens the first "Add section/item".
- The word "Initialize" is retired.

### 3.2 A clear, consistent action bar (stop hiding the essentials)
Rule: **creation is always visible; lifecycle/rare actions go to the overflow.**

```
BOQ · Working BOQ (in preparation)                 [ Add items ▸ ]  ← one contextual primary
Total 1,240,000  ·  Priced 180/240  ·  62%          ＋ Item   ＋ Section   ▣ Import   ⋯
                                                                              └ Export
                                                                                Submit for approval
                                                                                Start a revision
                                                                                Discard
```
- **Always visible:** the one contextual primary (**Add items → Price → Submit**), then **+ Item**, **+ Section**, **Import** as peer secondary buttons.
- **Overflow (`⋯`):** Export, Submit-for-approval (when it isn't already the primary), Start revision, Discard.
- Removes the current split where Import/Add-section sit in different places, and the stale "import is deliberately absent" toolbar note.

### 3.3 Editing — inline for values, dialog for structure
This is the pop-up-vs-inline decision, split by task:

- **Inline edit** for the money cells on an existing leaf row — **quantity** and **rate** (and description).
  Click the cell → it becomes an input → Enter/blur saves → the line total and headline update, and the
  **history log records it**. This is the 90% case (repricing) and the single biggest speed win.
  Affordance: on hover, an editable cell shows a faint underline + text cursor; frozen (Contract) cells don't.
- **Dialog** stays for **adding a node** (needs parent + kind + description + unit + method + basis + library)
  and for **structural edits** — but slimmed: the **code field is gone** (see 3.4), so it drops from 7 fields
  to 6, and quick value tweaks no longer need it at all.

```
Grid row, inline edit:
02.01.001  Mass concrete C25        m³     [  120.5 ]   [ 85.00 ]   10,242.50
                                            ^edit qty    ^edit rate   (auto)
```

### 3.4 Auto-numbering — the user never types a code
- The add dialog shows the code as a **read-only chip**: *"Code: 02.01.003 (auto)"*, derived from the
  parent + siblings (the logic already exists in `suggestNodeCode`).
- **Server assigns** the code when none is sent, so it's authoritative and collision-free — no more `400`
  on a duplicate a user couldn't have known about.
- **Override** is an "Advanced ▸ edit code" disclosure, hidden by default, for the rare renumber.
- Import is unchanged (codes come from the sheet, explicitly).

### 3.5 History log — "who changed what, and what was it before"
New capability. The Working BOQ gets a per-line audit trail, shown as a disclosure at the bottom
(sibling to the version panel):

```
▾ History
  Ahmed  changed rate of 02.01.001   80.00 → 85.00        3 Sep, 14:22
  Ahmed  added item 02.01.004  "Waterproofing"            3 Sep, 14:18
  Sara   imported 240 items from "BOQ-tender.xlsx"        2 Sep, 09:40
  Sara   deleted 03.02.007  "Temporary fencing"           1 Sep, 16:05
```
- **Backend:** a `BoqChangeEvent` row written **in the same transaction** as each node write —
  `{ versionId, nodeId?, code, action (CREATE|UPDATE|DELETE|MOVE|IMPORT), field?, oldValue?, newValue?, actorUserId, at }`.
- **Import** records **one** summary event ("imported N items"), not N rows, so the feed stays readable.
- Clicking a grid row filters the log to that line's history.
- This is what lets the Working BOQ stay one living document instead of a new version per edit.

### 3.6 State naming — words the team uses
| Internal (`status`) | Shown to users |
|---|---|
| `DRAFT` | **Working BOQ** — subtitle "in preparation" |
| `BASELINED` (contract) | **Contract BOQ** — with a **lock** icon + "official / signed" treatment |
| `SUPERSEDED` | **Past revision** |
| `CANCELLED` | **Discarded** |

The Contract BOQ gets a distinct, unmistakable visual (lock + solid accent border) so anyone can spot
"the official signed bill" at a glance.

### 3.7 Variations — connect the built module to the BOQ
The VO module exists (under Commercial). The refinement is **clarity + connection**, not a rebuild:

- **In the BOQ tab, once a Contract BOQ exists**, the "Add item" affordance changes to guidance:
  *"This BOQ is under contract. To add, omit or change work, raise a Variation."* → button links to the
  VO flow. (No silently editing a frozen bill; no accidental new version.)
- **Show varied scope in the BOQ:** lines with `sourceType = VARIATION` get a **"VO-3" chip**, and a filter
  **Original scope / Variations / All**. So original vs added work reads at a glance (the data's already there).
- **The VO flow itself**, presented as a clear linear path (the endpoints exist):
  `Raise → Add lines (contract rate, or a "star rate" for new work) → Submit → Internal approve →
  Client approve → Apply to BOQ`. Review whether the current Commercial UI presents this as a guided
  stepper; if not, that's the polish.
- **Keep VO management under Commercial** (it's a contractual/commercial document) but **cross-link** from
  the BOQ — don't duplicate.

### 3.8 Design-system notes (targeted, not a rewrite — the system is coherent)
- **Keep** the one-primary-button rule (already enforced) — it's good.
- **Add a "locked/official" treatment** for the Contract BOQ (lock glyph + solid accent left-border + a
  subtle "OFFICIAL" ribbon on the header) — a new *pattern*, reusing existing tokens, no new colors.
- **Inline-edit affordance:** editable cells get a hover underline + text cursor; frozen cells stay plainly
  static. This teaches editability without a manual.
- **Source/variation chip:** a distinct badge `tone` for VARIATION lines (reuse the badge component).
- **No change** to core color tokens, spacing scale, or radii — they're consistent; we add patterns, not paint.

---

## 4. Suggested build order (once decided)

| Phase | Deliverable | Notes |
|---|---|---|
| **1** | **History log** (backend event + bottom panel) | Highest-value, self-contained. "We really need this." |
| **2** | **Auto-numbering** (server assigns code; dialog chip; advanced override) | Small; removes the blank box. |
| **3** | **State renaming** (Working BOQ / Contract BOQ + locked treatment) | Copy + a visual pattern; low risk. |
| **4** | **Action-bar + first-run redesign** (two doors, always-visible creation) | UX restructure of the workspace shell. |
| **5** | **Inline edit** (qty/rate/description on leaves) | Bigger; needs careful save/optimistic UX + ties to the history log. |
| **6** | **Variations connection** (BOQ guidance + VO chip/filter + flow polish) | Depends on Contract-BOQ naming; connects the built module. |

Each phase is a reviewable slice, same as the import work.

---

## 5. Decisions — LOCKED 2026-09-04 ("I agree with you")

1. **Inline edit scope** — ✅ inline for **quantity + rate + description** on leaves; dialog for all structural changes.
2. **Auto-numbering** — ✅ code **fully server-assigned + read-only**; override behind an "Advanced" disclosure.
3. **History depth** — ✅ **hybrid**: value edits record **field-level old→new** (rate/qty/description); structural
   changes (add/delete/move) and import record **action-level** events. This gives "80.00 → 85.00" where it
   matters without noise on structure.
4. **First-run doors** — ✅ **Import** (visual primary) + **Start a blank BOQ**, no "Initialize".
5. **Naming** — ✅ **Working BOQ** (in preparation) / **Contract BOQ** (locked, official).
6. **Variations placement** — ✅ keep VO **management in Commercial** + **cross-link** from BOQ (guidance when the
   Contract BOQ exists, VO chip + Original/Variations/All filter on the lines).
7. **Contract type** — ⏳ **still open** (lump-sum vs remeasurable). Only colours **Phase 6 (Variations)**, so it does
   NOT block Phases 1–5. To confirm with the team / Eng Ahmed before Phase 6.

Build sequence per §4: **History → Auto-numbering → Naming → Action-bar/first-run → Inline edit → Variations.**
