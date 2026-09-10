# BOQ Workspace Redesign — internal budget, contract commitment, one living BOQ

**Status:** DESIGN — decisions D1–D7 owner-approved 2026-09-10 (`/grill-with-docs` session).
Model recorded as **ADR-029**. Not yet architected or built. Supersedes the "BOQ total ≠
contract value" boundary in ADR-016; makes ADR-020 CONST-BOQ-024/025 concrete; reverses the
direction of the ADR-026 variation trigger.

**Author:** product/eng acting as construction director + senior product designer + ERP
expert.

---

## 1. Why

The as-built BOQ (see `docs/design/boq-workspace-refinement.md` and the end-to-end audit)
models the BOQ as a client-facing priced bill with user-visible versions and a hard
immutable baseline, and treats the BOQ total as independent of the contract value. A
grilling session established that ACCO works differently: the BOQ is an **internal budget**
that allocates a pre-agreed **contract sum**, carries a deliberate **buffer**, is billed to
the client by **milestones** (not per line), should be **one living document + history** (no
versions), and is **lump-sum** (quantities never re-price the client).

## 2. The seven locked decisions

| # | Decision | Resolution (approved 2026-09-10) |
|---|---|---|
| **D1** | Is there a commitment moment? | **Yes — one.** Living BOQ (edit freely + history) → **Commit to contract** fixes the contract value → post-commit, money-neutral internal edits stay free+audited; value/scope changes are governed. |
| **D2** | What is a BOQ rate / what is the BOQ? | The BOQ is ACCO's **internal cost/budget plan** that **allocates the contract sum** (ties out to contract value). Not client-facing; client sees milestone invoices. *(Reverses ADR-016.)* |
| **D3** | How is the buffer held? | A **named Contingency / Preliminaries allowance** (its own line/pool), never smeared into work rates. |
| **D4** | How is extra work handled? | Estimated **on the BOQ**, then classified by a two-step "who pays / how": **Absorb** (from contingency) / **Variation-on-contract** (raises contract, client approves) / **Separate charge** (one-off invoice). |
| **D5** | One money number or two? | **Two** — **Contract value** vs **Total client revenue**. Absorbed scope & separate charges never move contract value. |
| **D6** | Versions or history? | **One living BOQ**, no version picker. Immutable **as-committed snapshots** at commit + each approved variation for the legal trail; surfaced as a **history timeline** + **compare-to-signed**. |
| **D7** | Lump-sum or remeasurable? | **Lump-sum.** Fixed contract value, milestone-billed; quantity variance is internal cost variance; client value moves only via variation. No remeasurement. |

## 3. The model

### 3.1 One screen, three life-stages

```
   WORKING  ───commit───►  COMMITTED  ───extra work───►  still one BOQ,
  (building)              (under contract)                contract grows via variations
```

No versions, no separate variation module — the same screen changes shape.

### 3.2 Money layers (what ties to what)

- **Contract value** = in-contract scope + contingency + on-contract variations. Fixed at
  commit; moves only via approved variation.
- **Total client revenue** = contract value + separate charges.
- **Contingency** = named pool inside the contract value; drawn down for overruns and
  absorbed scope; shows "remaining."
- **Expected cost / margin** (optional depth) tracked against the cost budget (separate
  aggregate, cost/revenue firewall preserved).

### 3.3 Post-commit change taxonomy (CONST-BOQ-029)

| What happens | Contract value | Contingency | Client revenue | Path |
|---|---|---|---|---|
| Typo / description / code / reorder | unchanged | — | — | Free + logged |
| Reallocate / cover overrun | unchanged | ↓ | — | Free + logged |
| Absorb extra scope (not billable) | unchanged | ↓ | — | Add line, from contingency |
| Variation — add to contract | **↑** | — | +on contract | Client approves via Commercial |
| Separate charge — pay now | unchanged | — | +one-off | One-off invoice |

## 4. UI proposal

### 4.1 The money band (always on top)

**Working:**
```
Villa 24 — BOQ · Project budget & scope                          ○ Working
Contract target   Allocated          Left to allocate
$500,000          $470,000           $30,000 → hold as contingency?
                  ▓▓▓▓▓▓▓▓▓░ 94%                      [ Commit to contract ]
```

**Committed:**
```
Villa 24 — BOQ · Project budget & scope              ● Committed · Lump-sum
Contract value   Contingency left    Cost to date    Client revenue
$500,000  🔒      $30,000 / $40,000   $210,000 · 42%  $502,000  (+$2,000 VO-1)
                 ▓▓▓▓▓▓▓░ 75% left
```

### 4.2 The tree

Contingency is a real, visible line; total ties to the contract.

```
Code   Description                     Qty   Unit   Budget
1      Substructure                                 $120,000
 1.1   Excavation                      100   m³     $8,000
 1.2   Foundation concrete             60    m³     $95,000
2      Superstructure                                $340,000
9      Contingency / Preliminaries                   $40,000   ⓘ cushion
       Total — ties to contract                      $500,000  ✓
```

### 4.3 First run → build (contract-first)

1. Two doors: **Import tender** (primary) / **Start blank**.
2. Set **contract target** → band shows "Left to allocate."
3. Build lines; meter fills; the remainder becomes **Contingency**.
4. **Commit to contract** enables once tied out + priced.

### 4.4 Commit (the one ceremony)

Single confirm: *"Commit this BOQ as the contract baseline — $500,000. This becomes the
signed record. You can keep editing internal budget afterwards; the contract value only
changes through an approved variation."* → freezes the as-committed snapshot.

### 4.5 Add extra work — two-question classifier

```
Add extra work
Estimate the extra lines:  Extra boundary wall  40 m²  $2,000   + add line

Who pays?      ○ ACCO absorbs it → from Contingency ($30,000 left)
               ● Client pays

How?           ● Add to the contract   $500k → $502k · needs client OK
               ○ Pay separately        one-off invoice · contract stays $500k
                                                   [ Cancel ] [ Create → ]
```

### 4.6 Contingency drawdown

Per-line **"Cover from contingency"** → move $X from pool to line. Total & contract
unchanged, cushion bar shrinks, logged.

### 4.7 History timeline + compare-to-signed

```
● Sep 20  Variation VO-1 approved — Boundary wall +$2,000 → contract $502,000   [compare]
● Sep 12  Covered overrun — $3,000 from contingency to Foundation (internal)
● Sep 10  Rate corrected — Labor 40 → 45 (internal, no contract change)
● Sep 1   ✓ Committed to contract — $500,000 signed baseline                    [view signed]
● Aug 25  Imported 142 lines from tender.xlsx
```

### 4.8 Where variations live (the bridge)

```
BOQ "Add extra work" → Client pays → Add to contract  (creates pre-priced variation)
      ▼
Commercial → Variations: client approval, revised contract, billing
      ▼
BOQ timeline: VO-1 approved, contract band → $502,000, snapshot taken
```

### 4.9 Professional principles

1. Plain language — "Commit to contract / Add extra work / Cover from contingency", never
   "baseline / draft / version".
2. One money band answers "where's the money" at a glance.
3. One BOQ, always — no versions, no dropdowns.
4. Contract value visibly locked (🔒).
5. Cost / contingency / margin / client-revenue never smear together.

## 5. Delta vs as-built

- Retire user-facing versions, version panel, "create revision" flow → one living BOQ +
  timeline + compare-to-signed (snapshots retained under the hood).
- "Baseline" → **Commit to contract**; governed seam (ADR-011) now gates commit + variation
  approval.
- New **Contingency / Preliminaries** first-class line/pool + drawdown.
- New commercial classification on post-commit lines (in-contract / variation / separate /
  absorbed / contingency).
- Contract value **derived from / validated against** the committed BOQ total (was a free
  figure).
- New **Total client revenue** figure alongside contract value.
- Variation trigger moves from Commercial to the BOQ; approval stays in Commercial.

## 6. Open items / next steps

1. **Architecture pass** (`/architect`) before any build — aggregate changes, tie-out
   enforcement, snapshot mechanics on the existing `BoqVersion`, contract-value derivation.
2. **Capability roles** (ADR-020 CONST-BOQ-022): who sees margin, who commits, who approves
   a variation — the BOQ now holds sensitive margin.
3. **Variation billing under milestone schedules** — how +$2,000 on a 500k milestone
   contract is invoiced (addendum vs re-spread). Confirm with Eng Ahmed.
4. **Expected-cost depth** — do we track per-line expected cost now, or rely on the existing
   cost budget aggregate? (Kept out of scope for the first cut.)
5. **Separate-charge object** — where a one-off client charge is recorded (Commercial) and
   how it rolls into Total client revenue.
