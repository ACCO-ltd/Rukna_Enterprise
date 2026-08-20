# Commercial payment model — policy confirmation for Eng Ahmed Shirie

**To:** Eng Ahmed Shirie (CEO, ACCO Ltd)
**From:** Abdulsalam (Backend)
**Date:** 2026-08-17
**Purpose:** We are building ACCO's real revenue model into Rukna — contracts paid by a **negotiated
payment schedule** (advance + staged installments), alongside the certified-progress (IPA/IPC) model
for consultant-supervised contracts. Before we freeze the design, please confirm the **four policy
points** below. Each has a concrete example and our recommended default — you can simply approve, or
give us ACCO's actual figures.

Running example throughout: a **$1,000,000** contract, **40% advance**, then staged installments.

---

## 1. Advance payment — it is treated as *money owed back*, not as earned income

When a client pays the 40% advance ($400,000) at the start, ACCO has **not yet earned it** — no work
is done. In proper accounting terms the advance is a **liability** (money we owe as work, or owe back
if the job stops), and it becomes "earned" only as we build.

Two things must therefore be tracked separately:

- **Advance received** — the $400,000 in the bank up front.
- **Advance recovery** — the advance is gradually **deducted back** from later payments, so we are not
  paid twice for the same work.

**Example (recovery by proportion):**
```
Advance received:                     $400,000  (40%)

Installment 2 gross (30%):            $300,000
  less advance recovery (40%):       −$120,000
  net paid to ACCO:                   $180,000

Installment 3 gross (20%):            $200,000
  less advance recovery (40%):        −$80,000
  net paid to ACCO:                   $120,000
... and so on until the $400,000 advance is fully recovered.
```

**➤ Decision needed:** Does ACCO recover the advance from later installments, and by which method?
- **(A) Proportional** — deduct the advance % (e.g. 40%) from every later payment until repaid. *(Our
  recommended default — simplest and self-balancing.)*
- **(B) Fixed rate** — deduct a set % (e.g. 20%) from each later payment until repaid.
- **(C) Bulk** — recover the advance from the final payment(s) only.
- **(D) No recovery** — the advance is simply the first payment, never clawed back.

---

## 2. Retention — a percentage *held back* from every payment, released later

On construction contracts the client typically **withholds a small % of each payment** as security
against defects, and **releases it later** (part at handover, part after the defects-liability period).
Retention is **not** a separate line in the payment plan — it is a deduction from each payment.

**Example (5% retention):**
```
Installment 2 (30%) gross:            $300,000
  less advance recovery:             −$120,000
  less retention (5% of gross):       −$15,000
  net cash to ACCO now:               $165,000
  (the $15,000 retention is held by the client)

Retention accumulates across all payments, then is released:
  50% at practical completion / handover
  50% at end of the defects-liability period
```

**➤ Decisions needed:**
1. **Retention %** withheld from each payment? *(Our recommended default: 5% — confirm 5% / 10% /
   other, or "ACCO does not use retention with these clients.")*
2. **Release schedule** — when is retention returned? *(Recommended default: 50% at handover, 50% at
   the end of the defects-liability period. Please confirm the defects-liability duration, e.g. 6 or
   12 months.)*

---

## 3. A payment becoming *due* does not automatically issue an invoice — a person authorizes it

When a scheduled date arrives or a milestone is reached, the system marks the payment
**"Ready to bill"** and tells the responsible officer:

```
Installment 2 — 30% — $300,000
Due: 05 Sep 2026 · READY TO BILL
Next action: prepare and issue the client invoice.
```

It then **waits for an authorized person to issue the invoice** — it never bills the client
automatically. This protects ACCO because at that moment there may be a client negotiation, a
suspension, an amended term, a dispute, or a document still outstanding.

**➤ Decision needed:** Please confirm **who is authorized to issue a client invoice** (e.g. the
Commercial officer / Finance, subject to the approval limits you already confirmed). We will apply the
same delegation-of-authority rules you signed off, so invoice issuance follows the correct authority.

---

## 4. A management early-warning: money collected vs. work actually done

Because ACCO is often paid **ahead of** physical progress (large advance + time-based installments),
management should always see whether **cash collected is running ahead of or behind actual
construction**. This is a health signal, not an accusation:

```
Al-Baraka Tower
Contractual collection to date:   70%   ($700,000)
Verified physical progress:       22%
⚠ Collection is well ahead of progress
```

- **Collection ahead of progress** (as above) is normal early in a job (advance + early installments)
  — but if it persists, it flags **cashflow we must still "earn out"** with real work.
- **Progress ahead of collection** flags that **ACCO is financing the client** — work done but not yet
  billed/paid.

**➤ Decision needed:** Confirm this **collection-vs-progress signal** is useful for ACCO's project
reviews, and whether you want a threshold that turns it into a formal alert (e.g. flag when the gap
exceeds 20%).

---

## Two model questions (quick confirmations)

5. **Milestone-triggered payments** — when an installment is released "on completion of X" (e.g.
   foundation), should the payment reference the **verified programme milestone** (so it's backed by
   real site evidence) rather than a free-standing note? *(Recommended: yes — tie payment milestones to
   verified progress.)*

6. **One model per contract** — is each contract either **payment-schedule** *or* **certified-progress
   (IPA/IPC)**, chosen when the contract is created — or can a single contract mix both? *(Recommended:
   one model per contract for now; we add "mixed" only if ACCO needs it.)*

---

## Summary of decisions requested

| # | Decision | Our default |
|---|---|---|
| 1 | Advance recovery method | Proportional (deduct advance % from each later payment) |
| 2a | Retention % per payment | 5% (or confirm 10% / none) |
| 2b | Retention release + defects-liability period | 50% handover / 50% end of DLP; DLP = 12 months |
| 3 | Who issues client invoices | Commercial/Finance per confirmed DOA limits |
| 4 | Collection-vs-progress signal + alert threshold | Yes; alert at >20% gap |
| 5 | Payment milestone references verified programme milestone | Yes |
| 6 | One billing model per contract (not mixed) | Yes for V1 |

Please confirm or adjust each. Once confirmed we freeze the Commercial payment-schedule design and
build it as the primary billing spine, with IPA/IPC as the certified-progress branch.
