# WhatsApp message templates (ADR-042)

Business-initiated WhatsApp messages must use a template Meta has approved. Submit these four in
**Meta Business Manager → WhatsApp Manager → Message templates → Create template**, then put each
approved template's exact name in the server's `apps/api/.env`:

| Purpose | Env variable | Suggested name |
|---|---|---|
| Invoice | `WHATSAPP_TEMPLATE_INVOICE` | `rukna_invoice` |
| Receipt | `WHATSAPP_TEMPLATE_RECEIPT` | `rukna_receipt` |
| Payment reminder | `WHATSAPP_TEMPLATE_PAYMENT_REMINDER` | `rukna_payment_reminder` |
| Overdue reminder | `WHATSAPP_TEMPLATE_OVERDUE_REMINDER` | `rukna_overdue_reminder` |

All four: **Category UTILITY**, **Language English (`en`)** → `WHATSAPP_TEMPLATE_LANGUAGE=en`.

Rukna fills the variables by position, always in the order {{1}}…{{5}} below, so do not reorder or
remove variables after approval. Meta asks for a sample value per variable; use the samples given.
Amounts are sent already formatted with their currency (e.g. `USD 12,500.00`), dates as
`15 Oct 2026`.

---

## 1. Invoice: `rukna_invoice`

- **Header:** DOCUMENT. Rukna attaches the invoice PDF; upload any sample PDF for Meta's review.
- **Body:**

  > Hello {{1}}, please find attached invoice {{2}} from {{5}} for {{3}}, due on {{4}}. If you have
  > any questions about this invoice, reply to this message. Thank you.

- **Footer (optional, no variables allowed):** `Sent via Rukna`

| Variable | Meaning | Sample |
|---|---|---|
| {{1}} | Client name | Hodan Construction Ltd |
| {{2}} | Invoice number | INV-000042 |
| {{3}} | Amount due | USD 12,500.00 |
| {{4}} | Due date | 15 Oct 2026 |
| {{5}} | Company name | ACCO Ltd |

## 2. Receipt: `rukna_receipt`

- **Header:** DOCUMENT (the receipt PDF).
- **Body:**

  > Hello {{1}}, thank you for your payment of {{3}} received on {{4}}. Your receipt {{2}} from {{5}}
  > is attached.

| Variable | Meaning | Sample |
|---|---|---|
| {{1}} | Client name | Hodan Construction Ltd |
| {{2}} | Receipt number | RCP-000017 |
| {{3}} | Amount received | USD 5,000.00 |
| {{4}} | Payment date | 02 Oct 2026 |
| {{5}} | Company name | ACCO Ltd |

## 3. Payment reminder: `rukna_payment_reminder`

- **Header:** none (text only).
- **Body:**

  > Hello {{1}}, this is a reminder from {{5}} that invoice {{2}} for {{3}} is due on {{4}}. If you
  > have already paid, please ignore this message. Thank you.

| Variable | Meaning | Sample |
|---|---|---|
| {{1}} | Client name | Hodan Construction Ltd |
| {{2}} | Invoice number | INV-000042 |
| {{3}} | Amount outstanding | USD 12,500.00 |
| {{4}} | Due date | 15 Oct 2026 |
| {{5}} | Company name | ACCO Ltd |

## 4. Overdue reminder: `rukna_overdue_reminder`

- **Header:** none (text only).
- **Body:**

  > Hello {{1}}, invoice {{2}} from {{5}} for {{3}} was due on {{4}} and is now overdue. Please
  > arrange payment, or reply to this message if there is a problem with the invoice.

| Variable | Meaning | Sample |
|---|---|---|
| {{1}} | Client name | Hodan Construction Ltd |
| {{2}} | Invoice number | INV-000042 |
| {{3}} | Amount outstanding | USD 12,500.00 |
| {{4}} | Original due date | 15 Sep 2026 |
| {{5}} | Company name | ACCO Ltd |

---

## Notes for the owner

- Meta rejects UTILITY templates that read as promotional; keep the wording factual.
- Editing an approved template sends it back to review. A renamed template needs its env variable
  updated and the API restarted.
- Until a template's env variable is set, Rukna cannot send that kind of message.

---

# Staff alerts — competitive quotations (ADR-044 phase 2)

Five more templates, sent to **ACCO staff** (not clients) when a quotation request needs a person.
They are written in **Somali**. Somali is not a language Meta offers for templates, so register each
one under **English (`en`)** — Meta does not check the text's language. Submit them in **WhatsApp
Manager → Message templates → Create template** with:

- **Category:** UTILITY
- **Language:** English (`en`) → server `WHATSAPP_TEMPLATE_QUOTE_LANGUAGE=en` (the default; separate
  from `WHATSAPP_TEMPLATE_LANGUAGE`, which the client templates use)
- **Header:** none · **Footer:** none (optional `Rukna`, no variables)
- **Body:** exactly the text below — variables by position, do not reorder after approval
- **Button:** one **Visit website** button, URL type **Dynamic**: the base is the tenant's web
  address followed by the path shown, and `{{1}}` is the quotation request id that Rukna appends.
  For ACCO the base is `https://acco.rukna.site` (another tenant uses its own subdomain — the URL is
  part of the template, never sent by the server). Sample for Meta: `cmgq7x2ab0001qr8k3m5n9p2t`.

The names below are the server defaults; set the env variable only if Meta approved a different
name. **No message carries a price or a total.**

| Purpose | Env variable (optional) | Default name | Button text | Button URL |
|---|---|---|---|---|
| Quotes ready | `WHATSAPP_TEMPLATE_QUOTE_READY` | `quote_ready_so` | Fur oo dooro | `https://acco.rukna.site/finance/quotes/{{1}}` |
| Reminder (2 working h) | `WHATSAPP_TEMPLATE_QUOTE_REMINDER` | `quote_reminder_so` | Fur oo dooro | `https://acco.rukna.site/finance/quotes/{{1}}` |
| Escalation (4 working h) | `WHATSAPP_TEMPLATE_QUOTE_ESCALATION` | `quote_escalation_so` | Fur | `https://acco.rukna.site/finance/quotes/{{1}}` |
| Store chosen | `WHATSAPP_TEMPLATE_QUOTE_CHOSEN` | `quote_chosen_so` | Samee dalabka | `https://acco.rukna.site/procurement/quotes/{{1}}` |
| Another quote needed | `WHATSAPP_TEMPLATE_QUOTE_ANOTHER` | `quote_another_so` | Fur | `https://acco.rukna.site/procurement/quotes/{{1}}` |

Values are cleaned before sending: Meta refuses newlines, tabs and runs of 4+ spaces in a variable,
so every whitespace run becomes one space; each value is cut to 60 characters (finance's note to
200) and an empty value is sent as `-`.

## 5. Quotes ready: `quote_ready_so`

To the finance selectors (award holders who can open the project, minus anyone segregation of
duties bars) when procurement sends the quotes, and again when a re-decision is requested.

> Codsiga quotation-ka {{1}} ee {{2}} (mashruuca {{3}}): {{4}} quotation ayaa diyaar ah. Fadlan dooro dukaanka laga iibsanayo.

Button: **Fur oo dooro** → `https://acco.rukna.site/finance/quotes/{{1}}`

| Variable | Meaning | Sample |
|---|---|---|
| {{1}} | Quotation request number | QR-00007 |
| {{2}} | Material request number | MR-00042 |
| {{3}} | Project name (`-` when none) | Hodan Tower |
| {{4}} | Number of quotes | 3 |

## 6. Reminder: `quote_reminder_so`

To the same selectors once the request has waited **2 working hours** for a decision.

> Xusuusin: Quotation-ka {{1}} ee {{2}} wuxuu sugayaa go'aankaaga muddo {{3}}. Iibsaduhu suuqa ayuu kugu sugayaa.

Button: **Fur oo dooro** → `https://acco.rukna.site/finance/quotes/{{1}}`

| Variable | Meaning | Sample |
|---|---|---|
| {{1}} | Quotation request number | QR-00007 |
| {{2}} | Material request number | MR-00042 |
| {{3}} | Waiting time | 2 saacadood |

## 7. Escalation: `quote_escalation_so`

To the **CFO and CEO** (role holders who can open the project) once the request has waited
**4 working hours**.

> Kor u qaadis: Quotation-ka {{1}} ee {{2}} (mashruuca {{3}}) wuxuu sugayay go'aanka maaliyadda muddo {{4}}. Fadlan arag.

Button: **Fur** → `https://acco.rukna.site/finance/quotes/{{1}}`

| Variable | Meaning | Sample |
|---|---|---|
| {{1}} | Quotation request number | QR-00007 |
| {{2}} | Material request number | MR-00042 |
| {{3}} | Project name (`-` when none) | Hodan Tower |
| {{4}} | Waiting time | 4 saacadood |

## 8. Store chosen: `quote_chosen_so`

To procurement (whoever opened the request or uploaded quotes) when finance's choice is final.

> Dukaanka {{1}} ayaa loo doortay {{2}}. Lacag bixinta: {{3}}. Fadlan samee dalabka iibka.

Button: **Samee dalabka** → `https://acco.rukna.site/procurement/quotes/{{1}}`

| Variable | Meaning | Sample |
|---|---|---|
| {{1}} | Store / supplier name | Bakaara Steel |
| {{2}} | Material request number | MR-00042 |
| {{3}} | Who pays | Iibsaduhu kaash ayuu bixinayaa |

`{{3}}` is `Iibsaduhu kaash ayuu bixinayaa` (the buyer pays cash) or `Maaliyadda ayaa bixinaysa`
(finance pays the supplier).

## 9. Another quote needed: `quote_another_so`

To procurement when finance asks for another quote.

> Maaliyaddu waxay u baahan tahay quotation kale oo loogu talagalay {{1}}. Qoraalka maaliyadda: {{2}}. Mahadsanid.

Button: **Fur** → `https://acco.rukna.site/procurement/quotes/{{1}}`

| Variable | Meaning | Sample |
|---|---|---|
| {{1}} | Material request number | MR-00042 |
| {{2}} | Finance's note (one line, ≤ 200 characters) | Fadlan keen quotation ka Xamar Steel |

## 10. Payment needed: `quote_pay_needed_so` (ADR-045)

To finance (`manage:payable` holders who can reach the project, not the request creator) when the
purchase order raised from an award is issued. No amount (product owner Q2 — the Phase 2 rule).

> Dalabka {{1}} ee dukaanka {{2}} (mashruuca {{3}}) waa la ansixiyay. Lacag bixinta: {{4}}. Fadlan bixi.

Button: **Bixi** → `https://acco.rukna.site/finance/quotes/{{1}}` (suffix = request id)

| Variable | Meaning | Sample |
|---|---|---|
| {{1}} | Purchase order number | PO-00311 |
| {{2}} | Store / supplier name | Bakaara Steel |
| {{3}} | Project name | Hodan Tower |
| {{4}} | Who pays | Iibsaduhu kaash ayuu bixinayaa |

Withdrawn at send time when the order is already being paid or the payment path changed.

## 11. Cash released: `quote_cash_released_so` (ADR-045)

To the buyer the cash was released to. The amount is visible only in the app behind login (Q2).

> Lacag caddaan ah ayaa laguu sii daayay dalabka {{1}} ee dukaanka {{2}}. Fur si aad u aragto qadarka, kadibna sawir rasiidka marka aad iibsato.

Button: **Fur** → `https://acco.rukna.site/procurement/quotes/{{1}}`

| Variable | Meaning | Sample |
|---|---|---|
| {{1}} | Purchase order number | PO-00311 |
| {{2}} | Store / supplier name | Bakaara Steel |

Withdrawn at send time when the advance was reversed.

## 12. Supplier paid: `quote_supplier_paid_so` (ADR-045)

To procurement (request creator + quote uploaders) when finance's payment to the store is posted.

> Maaliyaddu waxay lacagta u bixisay dukaanka {{1}} dalabka {{2}}. Alaabta qaado oo sawir rasiidka/invoice-ka.

Button: **Fur** → `https://acco.rukna.site/procurement/quotes/{{1}}`

| Variable | Meaning | Sample |
|---|---|---|
| {{1}} | Store / supplier name | Bakaara Steel |
| {{2}} | Purchase order number | PO-00311 |

Withdrawn at send time when the payment was reversed. Env overrides:
`WHATSAPP_TEMPLATE_QUOTE_PAY_NEEDED`, `WHATSAPP_TEMPLATE_QUOTE_CASH_RELEASED`,
`WHATSAPP_TEMPLATE_QUOTE_SUPPLIER_PAID`.

## Who receives staff alerts

Only users an administrator has given a **WhatsApp number** and **Send WhatsApp alerts** in
Administration → Users. Everyone keeps the in-app notification. The server only queues alerts when
`QUOTATION_WHATSAPP_ENABLED=true` (default off) and WhatsApp is configured.
