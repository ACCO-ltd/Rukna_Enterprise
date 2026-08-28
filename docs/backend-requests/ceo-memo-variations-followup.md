# For Eng Ahmed — Variations: four details to finish before we go further

*Follow-up to your 2026-08-27 memorandum. Plain-language; four short decisions. Your earlier answers
let us start building the core (raising and approving a variation, and keeping the contract value
honest). These four settle the rest of the build. Each has our recommendation.*

## Q1 — The "at-risk" dollar ceiling before the CEO must sign

You confirmed that when **urgent variation work has to start before the Variation Order is fully
signed**, the **Construction Director and the CFO authorise it together**, and it **escalates to the
CEO above the exposure cap.** We need the **cap** — the dollar figure of at-risk work above which the
CEO must also sign.

Example: if the cap is USD 25,000, then CD + CFO can authorise urgent at-risk work up to USD 25,000;
above that the CEO signs too.

→ *Please give the figure. (This is deliberately a separate number from the purchasing limits —
at-risk work carries a different kind of risk, so it shouldn't just inherit a PO threshold.)*

## Q2 — When approved variation scope is added, does the contract "baseline" move automatically?

When a variation is client-approved, its extra work is added to the project's bill of quantities as a
new, clearly-tagged version. The question: does the **contract baseline** — the exact version we
certify and bill against — **update automatically** to include the variation, or is adopting the new
version a **deliberate, recorded step** someone takes?

→ *Recommendation: a **deliberate, recorded step** ("adopt this variation into the contract"), not
automatic — so nothing enters what we bill against without a clear act on the record. Please confirm,
or tell us you want it automatic on approval.*

## Q3 — Can one variation cover two contracts at once?

A single client change usually sits within one contract. Occasionally a client might issue one change
that touches **two separate contracts** (say a framework agreement and a works package).

→ *Recommendation: for now, **one variation belongs to one contract** (if a change touches two
contracts, it's raised as two linked variations). Simpler and covers the normal case. Please confirm
this is enough for launch.*

## Q4 — What makes a variation officially "client-approved"?

A variation only changes the contract value once it has **client + contractual approval** (your Q2).
What does the system record as the **proof** of that approval?
- a **signed Variation Order document** attached (a scan/PDF), and/or
- a **client approval reference** (e.g. the client's letter/email reference number), and/or
- just an internal confirmation that approval was received.

→ *Recommendation: require an **approval reference** and allow an **attached signed document** — so
every contract-value change is backed by evidence on the record. Please confirm what you want captured
(and whether that final client-approval step itself needs a second internal sign-off, or is recorded
by the commercial lead alone).*

---

### Summary — what we need back
1. **Q1** — the at-risk exposure **cap** (USD).
2. **Q2** — contract baseline updates **automatically** on approval, or by a **deliberate step** (we
   recommend deliberate).
3. **Q3** — confirm **one variation = one contract** is enough for launch.
4. **Q4** — what evidence marks a variation **client-approved** (reference + attached document
   recommended), and who records it.

The core build (raise → approve a variation; contract value changes only on client approval) is
proceeding now with sensible defaults for Q4; your answers let us finish the scope-into-BOQ, the
contract-baseline step, and the at-risk route without guessing.

---

## DECISION — Eng Ahmed (2026-08-28): all recommendations accepted.

| Q | Decision | Resolves | Unblocks |
|---|---|---|---|
| **Q1** | At-risk exposure cap accepted as our judgement — **proposed default USD 25,000** (CD + CFO ≤ 25k; CEO above), pending Eng Ahmed's final figure. | OQ-1 (*provisional*) | P5 |
| **Q2** | The contract baseline moves by a **deliberate, recorded step** ("adopt this variation into the contract") — **never automatic** on approval. | OQ-2 | P2, P3 |
| **Q3** | **One variation = one contract** for V1 (a cross-contract change is raised as two linked VOs). Confirms the P1 aggregate root. | OQ-3 | model |
| **Q4** | Client-approval evidence = an **approval reference (required) + optional attached signed document**; **recorded by the commercial lead** (the internal DOA sign-off already occurred at PENDING_INTERNAL → INTERNAL_APPROVED). | OQ-4 | P3, finalises P1 clientApprove |

**Q1 note:** the USD 25,000 cap is an engineering placeholder we chose so P5 isn't blocked; it is
flagged for Eng Ahmed's explicit confirmation and is a one-line config change if he sets a different
figure.
