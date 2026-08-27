# For Eng Ahmed — Variations / Change Orders (how ACCO handles mid-project changes)

*Prepared for CEO sign-off. Plain-language. This unblocks building the "Variations" feature (issue #51).*

## What this is about

Almost no project is built exactly as the original contract. Part-way through, things change:
the client asks for an extra floor, a better finish, or a different material; a wall gets moved;
some scope is dropped. Each change usually affects **three things at once — the price, the work
scope, and the completion date.**

Right now the system only knows the **original** signed scope (the baselined BOQ) and the original
contract value. It has **no way to record a change** to that after the contract is active. We want
to build that, but exactly *how* ACCO runs a change on site is a business process only you can
confirm. Below are the questions; each has our best guess, so mostly you're confirming or
correcting.

---

## The questions

**Q1 — Is a change a formal, approved document before work starts?**
When the client wants extra/different work, does ACCO issue a written **Variation Order** that the
client (and ACCO) approves *before* the work is done — with its own reference number, description,
price, and any time extension?
→ *Our guess: Yes — a formal Variation Order, client-approved, before the work.*

**Q2 — Does a variation change the contract value?**
When a variation is approved, its price is **added to (or subtracted from) the contract value**, so
the contract total becomes original + all approved variations. Correct?
→ *Our guess: Yes.*

**Q3 — Can a variation be a *reduction* (omission)?**
Sometimes the client removes scope. Does ACCO issue **negative** variations (a credit / reduced
contract value)?
→ *Our guess: Yes — variations can be additions or omissions.*

**Q4 — How is variation work billed?**
Once a variation is approved and the work is done, is it **certified and invoiced the same way as
the rest of the project** (it just becomes new lines in the BOQ that flow through the normal
progress/certificate/invoice), or is it billed on a **separate** variation invoice?
→ *Our guess: it becomes new priced lines in the project and bills through the normal flow — no
separate variation invoice.*

**Q5 — Does a variation extend the completion date?**
Can an approved variation carry a **time extension** that moves the contract's expected completion
date?
→ *Our guess: Yes — a variation may grant extra days.*

**Q6 — Who approves a variation internally, and up to what value?**
Before ACCO commits to a variation, who signs off internally? Using the authority chain
(Project Manager / Construction Director → CFO → CEO), what value thresholds apply to a variation?
→ *Our guess: same DOA thresholds as a purchase (small → PM/Construction Director; larger → CFO;
very large → CEO). Please give the cut-offs, or your rule.*

**Q7 — (Issue #51) Work started before the contract is signed?**
Does ACCO ever begin construction **before** the client contract is fully executed (signed)? If so,
how is that period handled — is the eventual contract backdated to cover it, or is early work
captured some other way?
→ *This one we genuinely don't know — please describe how it works in practice.*

---

### Summary — what we need back
- Confirm Q1–Q6 (yes / correct, or the change you want), and give the value cut-offs for Q6.
- A short description for **Q7** — whether/how ACCO works before a signed contract.

With these answers we can design the Variation feature so scope, price, and time stay correct and
auditable over the whole project life.

---

## DECISION — Eng Ahmed (memorandum, 2026-08-27). Unblocks issue #51.

| Q | Decision |
|---|---|
| 1 | **Yes** — a formal Variation Order, approved before the work, **except** the single controlled route in Q7. |
| 2 | Contract value changes **only when the VO has the required client + contractual approval.** Until then the amount is reported as **Pending** and **must not be absorbed into contract value.** |
| 3 | **Yes** — omissions (negative variations) supported. |
| 4 | **Normal** Progress / IPA / IPC / Invoice / Payment cycle — **each variation separately identifiable throughout** (no separate variation invoice). |
| 5 | **Yes, as a *proposed* time impact only.** The contractual completion date does **not** move automatically. |
| 6 | **Existing** financial approval thresholds apply. **No separate variation authority matrix** at this stage. |
| 7A | Project begins **before** the main contract is executed — **permitted through a controlled route only.** |
| 7B | Urgent variation work **before** the VO is finalized — **at-risk route only, never on informal verbal instruction.** Authorized by the **Construction Director + CFO jointly**, escalating to the **CEO above the exposure cap.** |

**Design implications (for the scoping ADR):**
- A `VariationOrder` is a first-class, separately-identifiable entity with its own lifecycle
  (proposed → internally approved → client-approved). Contract value = original + **approved**
  variations; a **Pending** total is reported alongside but never folded into the governing value.
- Omissions are signed-negative VOs.
- Approved variation scope enters the project as separately-tagged priced work that flows through the
  existing Progress→IPA→IPC→Invoice chain, tagged to its VO throughout (traceable on every certificate/
  invoice line).
- Time impact is a **proposed** field on the VO; applying it to the contractual completion date is a
  **separate, explicit** action — never automatic.
- Governance reuses the existing DOA thresholds (ADR-022) — no new authority matrix. The two at-risk
  commencement routes (7A/7B) are **controlled, audited exceptions**, not the default path.
