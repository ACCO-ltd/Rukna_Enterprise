# Memo — how should progress roll up *inside* a work package?

**To:** Eng Ahmed Shirie (CEO, ACCO Ltd)
**From:** product/eng
**Date:** 2026-09-05
**Status:** **Option A implemented 2026-09-05** on Abdulsalam's instruction, including the
retrospective recompute. Questions 2 and 3 below were answered by that decision; question 1 is
recorded for confirmation, and the behaviour can still be changed if you want a different option.
See "What was built" at the end.

---

## The question in one line

When a work package contains BOQ items of very different sizes, should each item count **equally**
towards that package's percentage, or should a bigger item count for more?

Today it is **equally**, and we think that is probably wrong. We would rather ask than quietly
change a number that the whole project's headline progress is built on.

---

## What the system does today

Progress is measured in **quantities**, not percentages. A site engineer records "1,200 m³ of
excavation this week"; nobody types "80%". That part is right and is not in question.

The roll-up then works in three steps:

**1. Each BOQ item gets a percentage of its own.**

```text
item %  =  verified quantity to date  ÷  BOQ quantity
```

Only quantities on an **approved** daily report count.

**2. A work package averages its items — with every item counting equally.**

```text
work package %  =  the plain average of its items' percentages
```

**3. The project weights the packages, using the weights set in Plan & Setup.**

```text
project %  =  Σ ( work package weight × work package % )
```

Step 3 is deliberate and configurable. **Step 2 is the one nobody has decided.**

---

## Why step 2 matters

Take a Substructure package holding two items:

| Item | BOQ quantity | Done | Item % |
|---|---|---|---|
| Setting-out and site clearing | 1 lot | 1 lot | 100% |
| Reinforced concrete | 10,000 m³ | 500 m³ | 5% |

Today the package reads:

```text
(100% + 5%) ÷ 2  =  52.5% complete
```

A day of setting-out and a fortnight of concrete have moved this package to "half built", while
9,500 m³ of the actual work is still in the ground. If that package carries 20% of the project, the
project's headline progress has just been overstated by roughly 10 percentage points.

The error runs the other way too. A package with one enormous item and several small ones will
look **behind** for months while the big item does most of the real work.

The distortion is worst exactly where it matters most — the big, slow structural packages that
dominate a construction programme.

---

## The options

**Option A — value-weighted (our recommendation).**
Each item counts in proportion to its **money value** (BOQ quantity × rate).

```text
work package %  =  Σ (item value × item %)  ÷  Σ (item value)
```

In the example the package would read about **5%**, because that is what the money says has been
built. This is how a quantity surveyor already thinks about progress, it matches how an interim
payment application is measured, and it needs no new data — the BOQ already carries every rate.

*Caveat:* an item with no rate yet contributes nothing. On a working BOQ that is arguably correct
(unpriced scope has no measurable value), but you should be comfortable with it.

**Option B — quantity-weighted.**
Each item counts in proportion to its BOQ quantity. This fails whenever units differ: 10,000 m³ and
1 lot cannot be added, so quantities are only comparable inside a single unit. We do not recommend
it.

**Option C — leave it as a plain average, and manage it by structure.**
Keep today's behaviour and tell planners to build work packages out of similarly-sized items. This
is free, but it makes the number's accuracy depend on how carefully somebody grouped the BOQ, and
nothing in the system tells them when they got it wrong.

**Option D — per-item weights.**
Let a planner set a weight on each item inside a package, the way weights already work between
packages. Most control, most setup work, and one more thing to keep at 100%.

---

## What we need from you

1. Which option is right for how ACCO measures a project?
2. If Option A: are you comfortable that an **unpriced** item contributes nothing to progress until
   it is priced?
3. Should this apply retrospectively? Changing the formula will move the reported percentage on
   every live project — including any figure already shown to a client.

---

## Notes for whoever implements this

- The formula lives in `ProgressService.getRollup()` — `apps/api/src/business/construction/progress/`.
- Nothing about **recording** changes. Quantities, approval and the verified-quantity invariant all
  stay exactly as they are.
- Every surface reads the same roll-up (`GET /projects/:id/progress/rollup`) — the Progress tab, the
  project Overview card, the physical-vs-cost signal and the collection signal. Fixing it once fixes
  all four; getting it wrong once is wrong in all four.
- `ProgressSnapshot` rows store the percentage **as it was calculated at capture time**. A formula
  change will make historical snapshots inconsistent with new ones, so the progress curve will bend
  at the changeover. Worth deciding whether to recompute or to annotate.


---

## What was built (2026-09-05)

**Option A — value-weighted.** `weightedPackagePercent` in
`apps/api/src/business/construction/progress/domain/progress-rollup.ts`, called from
`ProgressService.getRollup()`.

```text
work package %  =  Σ (leaf value × leaf %)  ÷  Σ (leaf value)
```

The leaf's value is `BoqNode.totalAmount` — the server-computed line value — so the weighting
always agrees with the BOQ's own arithmetic and nothing new has to be derived.

Three behaviours worth knowing:

- **Every allocated leaf counts**, not only measured ones. A leaf with no progress yet still
  carries value; leaving it out would let a package read 100% the moment its first item finished.
- **Question 2 answered as "yes, an unpriced item contributes nothing"** — with one guard. If
  *nothing* in a package is priced there are no values to weight by, so it falls back to the plain
  average rather than reporting 0% for work that has genuinely happened. That is the only place the
  old behaviour survives, and only on a BOQ that has not been priced.
- **The worked example above is a test.** `progress.service.spec.ts` asserts the 1-lot /
  10,000 m³ package now reads ~5%, not 52.5%.

**Question 3 answered as "yes, retrospectively."**
`apps/api/scripts/recompute-progress-snapshots.ts` (`pnpm progress:recompute-snapshots
--slug=acco --dry-run` / `--apply`) replays every stored `ProgressSnapshot.physicalPercent` under
the new formula, so the progress curve does not bend at the changeover. It prints old → new and the
delta for every row it would touch, and writes nothing without `--apply`.

**It has not been run against any environment yet.** Run the dry run first and read the deltas.

### What the recompute cannot reconstruct

A snapshot froze "everything approved as of `capturedAt`". The script replays that using **today's**
work packages, allocations and BOQ values. It is a faithful replay only where those have not moved.
Three cases where it is not, none of them recoverable from stored data:

1. A report **reopened and re-approved** with different quantities — only the current quantities
   survive.
2. Work packages, allocations or weights **changed** since — the replay uses today's structure.
3. The BOQ **re-rated** since — the replay values leaves at today's rates.

This is why the script reports every change rather than applying silently.

### Separately noticed, not changed

`computeVerifiedPercent` — the figure stored as `ProgressSnapshot.verifiedPercent` — sums
*measurable quantities across all leaves*, which adds m³ to m² to kg. That total has no unit and no
meaning. It is a different bug from this one, it does not affect `physicalPercent`, and it was left
alone rather than folded into a change you were asked to approve. Worth its own decision.
