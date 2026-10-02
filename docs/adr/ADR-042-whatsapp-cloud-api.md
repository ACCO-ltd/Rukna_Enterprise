# ADR-042 — WhatsApp Cloud API integration

**Status:** Accepted (owner: Abdulsalam, 2026-10-02). Phase 1: the webhook. Phase 2 (2026-10-03):
the communication core — see below. Sending invoices / receipts / reminders plugs into it next.

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

## Phase 2 — communication core (2026-10-03)

The channel-agnostic layer every "send by WhatsApp" feature calls. No accounting endpoints and no
UI in this phase.

1. **`OutboundMessage` (tenant DB, `outbound_messages`)** — one row per business-initiated message:
   channel (`WHATSAPP`; `EMAIL` reserved), purpose (`INVOICE`, `RECEIPT`, `PAYMENT_REMINDER`,
   `OVERDUE_REMINDER`), client, recipient (E.164), the record it is about (`resourceType` +
   `resourceId`, e.g. `client_invoice`), template name + language, Meta's message id (unique),
   status + one timestamp per status, a typed error code + plain-words message, idempotency key,
   creator. `GET /communications?resourceType=&resourceId=` (`manage:receivable`) lists them, with
   the full number (those callers manage receivables).
2. **`OutboundMessageRoute` (platform DB, `outbound_message_routes`)** — Meta message id → tenant
   (FK to `tenants`, cascade). The webhook is public with no tenant subdomain, so it looks the id up
   here, resolves that tenant and applies the update inside `tenancyStorage.run`. Status updates no
   longer depend on `DEFAULT_TENANT_SLUG`, so a second tenant needs no change. The route is written
   before the tenant row is marked SENT, so an early webhook finds it. A route write failure is
   logged and does not fail a message Meta already accepted (it only loses that message's status
   updates).
3. **Status rules** — forward only: `QUEUED → SENT → DELIVERED → READ`. Meta's webhooks can arrive
   out of order; a late `sent` after `delivered` is ignored. `FAILED` may override
   QUEUED/SENT/DELIVERED but never READ (the client has read it). FAILED is terminal for webhooks.
   The guard is a conditional update in the database, so concurrent webhooks cannot regress a row;
   a repeat is a no-op. Unknown message ids are logged (masked) and ignored. The webhook answers
   Meta 200 immediately and routes the updates in the background.
4. **Idempotency** — unique `(organization_id, idempotency_key)`; callers pass a key that is stable
   per intended message. An existing row that is not FAILED is returned unchanged and nothing is
   sent again — including a row stuck in QUEUED (the process died mid-send; Meta may have accepted
   it, and a duplicate invoice to a client is worse than a deliberate re-send under a new key). A
   FAILED row is retried by **reusing the row** (conditionally re-armed to QUEUED with the new
   request's recipient/template, so two concurrent retries send once); the earlier failure stays in
   the audit log. A concurrent insert race (P2002) returns the winner's row.
5. **Errors** — `WhatsAppClient` (the only code calling graph.facebook.com; global `fetch`, 20 s
   timeout) maps Meta's codes to `NOT_CONFIGURED`, `AUTH_FAILED` (190, 0, 10, 200–299, HTTP 401/403),
   `INVALID_RECIPIENT` (131026, 131030, 131021, malformed number), `TEMPLATE_NOT_APPROVED` (132000–132999),
   `RATE_LIMITED` (130429, 131048, 131056, 4, 80007, HTTP 429), `MEDIA_UPLOAD_FAILED` (131052, 131053,
   any other upload error), `NETWORK` (unreachable / timeout), `PROVIDER_ERROR` (anything else).
   Provider failures never throw out of `CommunicationService`: the row becomes FAILED and is
   returned for the caller to show. Only invalid input throws. The token never appears in logs or
   errors (Meta's own error text is not stored); phone numbers are logged masked to the last 4
   digits; audit rows (`resource: 'outbound-message'`, actions `whatsapp.sent` / `whatsapp.failed`)
   carry no amounts and a masked number. Webhook status changes are not audited (no acting user).
6. **Documents are uploaded to Meta** (`POST /{phone-number-id}/media`) and sent by media id as the
   template's DOCUMENT header — never as a public link to our storage.
7. **No queue yet** — sending is synchronous inside the caller's request (one upload + one send,
   at most 2 × 20 s). A job queue comes when volume or scheduled reminders need it.
8. **Templates** are configured per server (`WHATSAPP_TEMPLATE_INVOICE`, `…_RECEIPT`,
   `…_PAYMENT_REMINDER`, `…_OVERDUE_REMINDER`, `WHATSAPP_TEMPLATE_LANGUAGE` default `en`,
   `WHATSAPP_GRAPH_VERSION` default `v21.0`) and resolved by `whatsapp-templates.ts`. Texts to
   submit to Meta: `docs/integrations/whatsapp-templates.md`.
