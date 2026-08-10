# Two Questions for Eng Ahmed Shirie

From: Frontend Engineer
Date: 2026-08-04
Reading time: about three minutes

---

Two decisions about how ACCO actually works are holding up parts of the system. Neither is
a technical problem — the code can be written either way in a day. What we don't know is
which way is *correct for the business*, and guessing wrong here produces numbers that look
right and are not.

Both questions are below with what each answer would mean. There is no wrong answer and no
preferred one; we need the rule so the software can enforce it.

---

## Question 1 — Can one Bill of Quantities hold more than one currency?

**Where this comes up.** Today, each individual line in a BOQ can carry its own currency.
Nothing stops one line being priced in USD and the line beneath it in SAR.

**Why that's a problem.** The system adds up the lines in a section to show a section total,
and adds the sections to show a BOQ total. If the lines are in different currencies, that
total is the sum of two different kinds of money — a number that means nothing, displayed
with a single currency symbol next to it, in a document used to value a contract.

**What the system does right now.** It refuses. Where a section contains mixed currencies,
we show no total rather than a misleading one. That is deliberate and it is live today.

**What we need to know:**

1. **Does ACCO ever price a single BOQ in more than one currency?** The cases we'd expect
   are a split-FX contract, or an imported-materials package priced in the supplier's
   currency. We don't know whether that reflects your practice.

2. **If not** — should the currency be fixed for the whole project or the whole BOQ, so
   individual lines cannot diverge in the first place? That's the safer design, and it makes
   the problem impossible rather than merely detected.

3. **If yes** — what should a section total show when its lines are in different currencies?
   Options we can build: show each currency separately (`USD 40,000 + SAR 15,000`); show a
   converted total at a stated exchange rate, with the rate and date printed alongside; or
   keep showing nothing and let the reader add up the lines they care about.

**What changes when you answer.** If currency is fixed per project, we lock it at the top and
the question disappears permanently. If mixed currencies are real, we build whichever total
you name. Until then the BOQ withholds those totals, which is safe but unhelpful.

---

## Question 2 — Can a payment application claim *less* than has already been certified?

**Where this comes up.** A payment application records the **total claimed to date** on each
line, not the amount for this month. The system works out this month's figure by subtracting
what was certified previously:

> **this period = total claimed to date − previously certified**

**The case we need a ruling on.** If a quantity surveyor enters a total-to-date that is
*lower* than what was already certified — because an earlier certificate over-measured and
the correction is being made now — this period comes out **negative**. The application then
reduces the amount owed rather than increasing it.

Our assumption is that this is **legitimate and normal** on a measured contract: it is how a
claw-back after an over-certification is expressed. But we would rather be told than assume,
because the system currently accepts it silently, with no warning to the person entering it
and no note on the certificate explaining why a line went backwards.

**What we need to know:**

1. **Is a negative period amount legitimate?** If yes, should the person entering it be
   warned and asked to record a reason, or is it routine enough to accept quietly? Our
   recommendation would be to require a short reason, so the certificate carries its own
   explanation six months later — but that adds a step to a routine correction, and if
   claw-backs are common at ACCO that friction may not be worth it.

2. **Should a claim ever be allowed to exceed the quantity in the contract's BOQ?** Normally
   the answer is a variation order, and this platform has no variations module yet. We have
   therefore assumed the answer is *"reject it for now"* and have raised it with the backend
   engineer as a defect to be fixed
   ([issue #19](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/19)). **If that
   assumption is wrong — if ACCO does legitimately claim past the BOQ quantity before a
   variation is formalised — please say so and we will withdraw it**, because right now
   the system allows it and we are about to stop it.

**What changes when you answer.** The claim entry form will block, warn, or stay silent
exactly as you specify. It currently does none of those things consistently, because a form
that enforces a rule the system does not share just rejects work the system would have
accepted.

---

## 3. When a client pays, are we recording that payment once or twice?

*Raised 2026-08-10, while building client invoices.*

A client payment can now be recorded against two different things, and the system keeps both
records separately:

- against the **payment certificate** — "this money settles certificate 14"
- against the **invoice** — "this money clears invoice INV-2026-031"

Every invoice is raised from one certificate, so most of the time these are the same event
written down twice: once for commercial tracking, once for the accounts.

**The problem is that nothing connects them.** A payment of $10,000 can be recorded in full
against the certificates *and* in full against the invoices, and the system accepts both. It
can also be recorded against certificate 14 but invoice 31 — which came from a different
certificate — and nothing objects.

**What we need to know:**

1. When ACCO receives a payment, is that **one event recorded in two places**, or can a single
   receipt genuinely be split differently between certificates and invoices?
2. If it is one event: should choosing the certificate automatically decide the invoice, so the
   two can never disagree?

**What changes when you answer.** If it is one event, the screen will let you allocate once and
apply it to both records together. If they are genuinely separate, we will add a check so the
two together can never exceed the money actually received. Right now neither is true: the
screen for recording payments against invoices has deliberately **not been built** while this is
open, because a screen that lets the same cash be counted twice will eventually put a wrong
balance on a client statement.

---

## What happens after you answer

The answers become rules in the system itself, not guidance in a document — enforced where
the data is saved, so they hold no matter which screen or which person enters it.

Reply however is easiest: a note, a call, or a line each. If a question is wrong-headed or
missing something obvious about how the business works, that is itself the most useful
answer.

---

*Derived from `docs/backend-requests/frontend-blockers.md`, items D1, D4 and A12, which carry
the technical detail behind these questions. That document is written for the backend
engineer and is not worth your time; this page is the whole of what we need from you.*
