# Memo — how should progress roll up *inside* a work package?

**To:** Eng Ahmed Shirie (CEO, ACCO Ltd)
**From:** product/eng
**Date:** 2026-09-05
**Decision needed before:** any further work on the Progress workspace's headline figure.
**Status:** open question. No code changed.

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
