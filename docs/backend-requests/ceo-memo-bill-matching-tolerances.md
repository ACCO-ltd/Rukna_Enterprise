# For Eng Ahmed — Bill-matching tolerances & the payment-hold rule

*Prepared for CEO sign-off. Plain-language; no system jargon. Two decisions, then the numbers.*

## What this is about

When a supplier sends us a bill, the system compares three documents before we're allowed to
pay it — a **3-way match**:

1. the **Purchase Order** (what we ordered, and at what price),
2. the **Goods Receipt** (what the storekeeper actually received on site),
3. the **Supplier Bill** (what the supplier is charging us).

If all three agree, the bill is cleared for payment. If they disagree, someone has to look at it.
The question is: **how much disagreement is "close enough" to clear automatically, and how much
should stop the payment until a person approves it?**

Two real examples of small disagreement:
- We ordered cement at **$100/bag**; the supplier bills **$102/bag** (2% higher).
- We ordered **500 bags**; the supplier receives/bills **505 bags** (1% more).

If we demand a *perfect* match, every trivial rounding or price-update stalls the payment run and
a person has to hand-approve it — slow, and people start rubber-stamping. If we allow *too much*
slack, real overbilling slips through and we pay more than we should. The right setting is a small
tolerance band.

---

## Decision 1 — The tolerance numbers

Please give us the acceptable variance for each. (Our current defaults are shown — please confirm
or change.)

| What varies | Example | Our suggested limit | Your decision |
|---|---|---|---|
| **Unit price** on the bill vs the PO | billed $102 vs ordered $100 | within **2%** auto-clears | ____ % |
| **Quantity** on the bill vs what was received | 505 vs 500 | within **0%** (must match exactly) | ____ % |
| **Over-receipt** — receiving *more* than ordered | 525 delivered vs 500 ordered | up to **5%** allowed, above that needs approval | ____ % |
| A flat **cash amount** we ignore regardless | a $1–2 rounding difference | e.g. **$5** | $ ____ |

Notes:
- These are **company-wide** settings (one number each, applied everywhere) — we are deliberately
  **not** building a screen to set different tolerances per supplier or per material. If you ever
  need that later, we can add it, but it is not worth the complexity now.
- A tolerance of **0%** means "must match exactly." That is a valid, strict choice for quantities.

## Decision 2 — What happens when a bill is *outside* tolerance

Today the system flags an out-of-tolerance bill but **still lets it be paid** — the control has no
teeth. We recommend changing this so that an out-of-tolerance bill is **held** and **cannot be
paid** until someone with authority approves the exception.

**Please confirm:** an out-of-tolerance bill should be **blocked from payment** until an exception
is approved. → *Recommended: Yes.*

And: **who approves a matching exception?** Our finance chain is **Accountant → Finance Officer →
CFO**. Suggested rule:
- small variance (within a low cash limit) → **Finance Officer**,
- larger variance → **CFO**.

Please give us the cash cut-off, or tell us the rule you want. → *Suggested cut-off: $____ (e.g.
Finance Officer up to $1,000, CFO above).*

---

### Summary — what we need back
1. The four tolerance numbers in the table above.
2. Confirm out-of-tolerance bills are **blocked** until approved (yes/no).
3. Who approves an exception, and the cash cut-off between Finance Officer and CFO.

---

## DECISION — Eng Ahmed (memorandum, 2026-08-27). ADR-018/ADR-024 item D now closed.

| # | Question | ACCO decision |
|---|---|---|
| 1 | Unit-price difference | **2%** — confirmed |
| 2 | Quantity difference | **No — 0%.** Payment against **accepted quantity only** |
| 3 | Over-delivery / over-receipt | **5%** — confirmed, unchanged |
| 4 | Small monetary tolerance | **USD 5 — applied per invoice, not per line** |
| 5 | Out-of-tolerance treatment | **Yes — blocked, visible, never auto-rejected** until an exception is approved |
| 6 | Exception approval authority | **Finance Manager up to USD 1,000; CFO above USD 1,000** |

Build implications (see `bill-matching.service.ts`):
- Platform fallback becomes **price 2% / qty 0%** (was 5% / 5%). Over-receipt (5%) is a separate
  `OverReceiptPolicy` and stays as-is.
- The USD-5 tolerance moves from a **per-line** `amountVarianceAbsolute` check to a **per-invoice**
  (whole-bill) rounding absorb.
- Enforcement already holds (`POSTABLE_MATCH_STATUSES` blocks `EXCEPTION`); confirm it.
- New: exception-approval **authority by amount** — FM ≤ USD 1,000, CFO above.
