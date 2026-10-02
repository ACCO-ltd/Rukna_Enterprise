# ADR-042 — WhatsApp Cloud API integration

**Status:** Accepted (owner: Abdulsalam, 2026-10-02). Phase 1 (this change): the webhook only.

## Context

ACCO's clients are reached mainly on WhatsApp. Today "Send invoice" can only open WhatsApp with a
number typed by hand, and nothing is attached or tracked. ACCO has created a Meta app with the
WhatsApp Business Platform (Cloud API) so Rukna can send invoices itself and record delivery.
Meta's production setup requires a public webhook endpoint before anything else.

## Decision

1. **Meta's Cloud API directly**, no third-party provider (Twilio etc.): one fewer vendor, and it is
   the API Meta's dashboard already set up for ACCO.
2. **Secrets live only in the server environment** (`apps/api/.env` on the VPS), never in the repo:
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN` (a permanent
   System User token, not the 24-hour test token), `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_BUSINESS_ACCOUNT_ID`.
3. **Webhook:** `https://api.rukna.site/api/v1/webhooks/whatsapp`, public (Meta has no Rukna
   login).
   - GET answers Meta's handshake only for the configured verify token.
   - POST is accepted only when `X-Hub-Signature-256` is the HMAC-SHA256 of the raw body with the
     app secret. A missing secret refuses everything.
   - The API is created with `rawBody: true` so the signature is checked over Meta's exact bytes.
4. **Tenant:** `api.rukna.site` carries no tenant subdomain, so the webhook runs as
   `DEFAULT_TENANT_SLUG` (ACCO). A second tenant would map Meta's `phone_number_id` to its
   organisation — deferred until there is one.
5. **Phase 1 logs status updates** (recipient masked). Phase 2 ("send invoice by WhatsApp") adds the
   sending client, message templates, a delivery record per message and status tracking on the
   invoice timeline.

## Consequences

- Meta's "Verify and save" works once this is deployed and the two webhook variables are set.
- Business-initiated messages need Meta-approved templates and a payment method on the WhatsApp
  account; those are business steps in Meta, not code.
