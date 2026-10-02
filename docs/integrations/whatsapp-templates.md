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
| {{2}} | Invoice number | INV-2026-0042 |
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
| {{2}} | Receipt number | RCT-2026-0017 |
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
| {{2}} | Invoice number | INV-2026-0042 |
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
| {{2}} | Invoice number | INV-2026-0042 |
| {{3}} | Amount outstanding | USD 12,500.00 |
| {{4}} | Original due date | 15 Sep 2026 |
| {{5}} | Company name | ACCO Ltd |

---

## Notes for the owner

- Meta rejects UTILITY templates that read as promotional; keep the wording factual.
- Editing an approved template sends it back to review. A renamed template needs its env variable
  updated and the API restarted.
- Until a template's env variable is set, Rukna cannot send that kind of message.
