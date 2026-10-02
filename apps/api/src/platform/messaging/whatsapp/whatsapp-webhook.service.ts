import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** One delivery-status update Meta reports for a message we sent (sent / delivered / read / failed). */
export interface WhatsAppStatusUpdate {
  messageId: string;
  status: string;
  /** The recipient, masked to the last 4 digits for logs. */
  recipient: string;
  timestamp: string;
  errors?: Array<{ code?: number; title?: string }>;
}

/**
 * ADR-042 — the WhatsApp Cloud API webhook: Meta's one-time verification handshake, and the
 * signed status/message notifications it posts afterwards.
 *
 * Nothing secret is ever in code: the verify token and the app secret are server environment
 * variables (`WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`). An unsigned or wrongly
 * signed notification is refused — the endpoint is public, so the signature is the only proof a
 * request came from Meta.
 */
@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);
  /** Each missing-setting error is logged once, not on every (possibly hostile) request. */
  private readonly warned = new Set<string>();

  constructor(private readonly config: ConfigService) {}

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.logger.error(message);
  }

  /**
   * Meta's GET handshake: echo `hub.challenge` only when the mode is `subscribe` and the token is
   * the one configured on this server. Returns null to refuse.
   */
  verifyHandshake(mode: unknown, token: unknown, challenge: unknown): string | null {
    const expected = this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN')?.trim();
    if (!expected) {
      this.warnOnce('verify', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set — refusing the webhook handshake');
      return null;
    }
    // Query values can arrive as arrays or objects (`hub.challenge[]=…`); only plain strings count.
    if (typeof mode !== 'string' || typeof token !== 'string' || typeof challenge !== 'string') return null;
    if (mode !== 'subscribe' || !token || !challenge || !safeEqual(token, expected)) return null;
    return challenge;
  }

  /**
   * Whether `X-Hub-Signature-256` is Meta's HMAC-SHA256 of the exact raw body with the app secret.
   * A missing secret refuses everything rather than accepting unsigned traffic.
   */
  isSignatureValid(rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean {
    const secret = this.config.get<string>('WHATSAPP_APP_SECRET')?.trim();
    if (!secret) {
      this.warnOnce('secret', 'WHATSAPP_APP_SECRET is not set — refusing webhook notifications');
      return false;
    }
    if (!rawBody || !signatureHeader?.startsWith('sha256=')) return false;
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    return safeEqual(signatureHeader, expected);
  }

  /**
   * Reads the status updates out of a notification. Delivery tracking against invoices arrives
   * with the "send invoice by WhatsApp" feature; until then they are logged (recipient masked).
   */
  handleNotification(payload: unknown): WhatsAppStatusUpdate[] {
    const updates = extractStatuses(payload);
    for (const u of updates) {
      this.logger.log(`WhatsApp message ${u.messageId} → ${u.status} (to ${u.recipient})`);
    }
    return updates;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function mask(phone: unknown): string {
  const digits = typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
  return digits.length > 4 ? `…${digits.slice(-4)}` : '…';
}

/** `entry[].changes[].value.statuses[]`, the shape the Cloud API posts. Anything else is ignored. */
export function extractStatuses(payload: unknown): WhatsAppStatusUpdate[] {
  const out: WhatsAppStatusUpdate[] = [];
  const entries = (payload as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const statuses = (change as { value?: { statuses?: unknown[] } })?.value?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const s of statuses as Array<Record<string, unknown>>) {
        if (typeof s?.id !== 'string' || typeof s?.status !== 'string') continue;
        out.push({
          messageId: s.id,
          status: s.status,
          recipient: mask(s.recipient_id),
          timestamp: typeof s.timestamp === 'string' ? s.timestamp : '',
          ...(Array.isArray(s.errors) ? { errors: s.errors as WhatsAppStatusUpdate['errors'] } : {}),
        });
      }
    }
  }
  return out;
}
