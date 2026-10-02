import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * ADR-042 phase 2 — the ONLY code that calls graph.facebook.com.
 *
 * Settings (server environment only): WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
 * WHATSAPP_GRAPH_VERSION (default v21.0). They are read on every call, so a token rotated in the
 * environment takes effect on restart without code changes.
 *
 * Never logged and never in an error: the access token, a full phone number (masked to the last 4).
 */

export type WhatsAppSendErrorCode =
  | 'NOT_CONFIGURED'
  | 'AUTH_FAILED'
  | 'INVALID_RECIPIENT'
  | 'TEMPLATE_NOT_APPROVED'
  | 'RATE_LIMITED'
  | 'MEDIA_UPLOAD_FAILED'
  | 'NETWORK'
  | 'PROVIDER_ERROR';

/** A provider-side failure. `message` is plain words safe to show staff and store. */
export class WhatsAppSendError extends Error {
  constructor(
    readonly code: WhatsAppSendErrorCode,
    message: string,
    /** Meta's numeric error code, when Meta answered with one. */
    readonly providerCode?: number,
  ) {
    super(message);
    this.name = 'WhatsAppSendError';
  }
}

export interface WhatsAppTemplateMessage {
  /** E.164 (`+252612345678`); sent to Meta as digits only. */
  to: string;
  templateName: string;
  /** Template language code, e.g. 'en'. */
  language: string;
  /** Values for {{1}}, {{2}}, … of the template body, in order. */
  bodyParams: string[];
  /** A DOCUMENT header (invoice / receipt PDF) uploaded first with `uploadMedia`. */
  document?: { mediaId: string; filename: string };
}

export const WHATSAPP_DEFAULT_GRAPH_VERSION = 'v21.0';
export const WHATSAPP_REQUEST_TIMEOUT_MS = 20_000;

const E164 = /^\+?[1-9]\d{7,14}$/;

const PLAIN: Record<WhatsAppSendErrorCode, string> = {
  NOT_CONFIGURED: 'WhatsApp sending is not set up on this server.',
  AUTH_FAILED: 'WhatsApp refused our access token. An administrator must renew the WhatsApp connection.',
  INVALID_RECIPIENT: 'This number cannot receive WhatsApp messages from us (not on WhatsApp or not allowed).',
  TEMPLATE_NOT_APPROVED:
    'WhatsApp rejected the message template (not approved, missing, or its details do not match).',
  RATE_LIMITED: 'WhatsApp is limiting how many messages we can send right now. Try again later.',
  MEDIA_UPLOAD_FAILED: 'WhatsApp could not accept the attached document.',
  NETWORK: 'Could not reach WhatsApp. Check the connection and try again.',
  PROVIDER_ERROR: 'WhatsApp could not send the message.',
};

const AUTH_CODES = new Set([0, 10, 190]);
const RECIPIENT_CODES = new Set([131021, 131026, 131030]);
const RATE_CODES = new Set([4, 80007, 130429, 131048, 131056]);
const MEDIA_CODES = new Set([131052, 131053]);

/** Meta numeric error code → our typed code. Shared with the webhook's delivery-failure handling. */
export function classifyMetaError(providerCode: number | undefined, httpStatus?: number): WhatsAppSendErrorCode {
  if (providerCode !== undefined) {
    if (AUTH_CODES.has(providerCode) || (providerCode >= 200 && providerCode <= 299)) return 'AUTH_FAILED';
    if (RECIPIENT_CODES.has(providerCode)) return 'INVALID_RECIPIENT';
    if (providerCode >= 132000 && providerCode <= 132999) return 'TEMPLATE_NOT_APPROVED';
    if (RATE_CODES.has(providerCode)) return 'RATE_LIMITED';
    if (MEDIA_CODES.has(providerCode)) return 'MEDIA_UPLOAD_FAILED';
  }
  if (httpStatus === 401 || httpStatus === 403) return 'AUTH_FAILED';
  if (httpStatus === 429) return 'RATE_LIMITED';
  return 'PROVIDER_ERROR';
}

/** Plain-words description for a typed code. */
export function describeWhatsAppError(code: WhatsAppSendErrorCode): string {
  return PLAIN[code];
}

/** `…1234` — the only form a phone number takes in logs. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length > 4 ? `…${digits.slice(-4)}` : '…';
}

@Injectable()
export class WhatsAppClient {
  private readonly logger = new Logger(WhatsAppClient.name);

  constructor(private readonly config: ConfigService) {}

  /** True when both the access token and the phone number id are set. */
  isConfigured(): boolean {
    return this.settings() !== null;
  }

  /** POST /{phone_number_id}/media — returns Meta's media id for a document header. */
  async uploadMedia(bytes: Buffer, mimeType: string, filename: string): Promise<string> {
    const s = this.require();
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);

    const body = await this.call(s, `${s.phoneNumberId}/media`, { method: 'POST', body: form }, 'MEDIA_UPLOAD_FAILED');
    const id = (body as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !id) {
      throw new WhatsAppSendError('MEDIA_UPLOAD_FAILED', PLAIN.MEDIA_UPLOAD_FAILED);
    }
    return id;
  }

  /** POST /{phone_number_id}/messages with a template — returns Meta's message id (`wamid.…`). */
  async sendTemplate(message: WhatsAppTemplateMessage): Promise<{ providerMessageId: string }> {
    const s = this.require();
    if (!E164.test(message.to.trim())) {
      throw new WhatsAppSendError('INVALID_RECIPIENT', 'The phone number is not a valid international number.');
    }
    const to = message.to.replace(/\D/g, '');

    const components: Array<Record<string, unknown>> = [];
    if (message.document) {
      components.push({
        type: 'header',
        parameters: [{ type: 'document', document: { id: message.document.mediaId, filename: message.document.filename } }],
      });
    }
    if (message.bodyParams.length > 0) {
      components.push({ type: 'body', parameters: message.bodyParams.map((text) => ({ type: 'text', text })) });
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: message.templateName,
        language: { code: message.language },
        ...(components.length > 0 ? { components } : {}),
      },
    };

    const body = await this.call(
      s,
      `${s.phoneNumberId}/messages`,
      { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } },
      'PROVIDER_ERROR',
    );
    const id = (body as { messages?: Array<{ id?: unknown }> } | null)?.messages?.[0]?.id;
    if (typeof id !== 'string' || !id) {
      throw new WhatsAppSendError('PROVIDER_ERROR', PLAIN.PROVIDER_ERROR);
    }
    this.logger.log(`WhatsApp template ${message.templateName} accepted for ${maskPhone(to)} (${id})`);
    return { providerMessageId: id };
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private settings(): { token: string; phoneNumberId: string; version: string } | null {
    const token = this.config.get<string>('WHATSAPP_ACCESS_TOKEN')?.trim();
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')?.trim();
    if (!token || !phoneNumberId) return null;
    const version = this.config.get<string>('WHATSAPP_GRAPH_VERSION')?.trim() || WHATSAPP_DEFAULT_GRAPH_VERSION;
    return { token, phoneNumberId, version };
  }

  private require(): { token: string; phoneNumberId: string; version: string } {
    const s = this.settings();
    if (!s) throw new WhatsAppSendError('NOT_CONFIGURED', PLAIN.NOT_CONFIGURED);
    return s;
  }

  /**
   * One Graph API call with a timeout. Every failure becomes a WhatsAppSendError; `fallback` is the
   * code for a Meta error that matches no specific class (media upload vs. send).
   */
  private async call(
    s: { token: string; version: string },
    path: string,
    init: { method: string; body: BodyInit; headers?: Record<string, string> },
    fallback: 'MEDIA_UPLOAD_FAILED' | 'PROVIDER_ERROR',
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WHATSAPP_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`https://graph.facebook.com/${s.version}/${path}`, {
        method: init.method,
        body: init.body,
        headers: { ...init.headers, Authorization: `Bearer ${s.token}` },
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      // The error's own text never leaves here: it could echo request details.
      this.logger.warn(`WhatsApp request to /${path.split('/').pop()} failed: ${timedOut ? 'timeout' : 'network error'}`);
      throw new WhatsAppSendError(
        'NETWORK',
        timedOut ? 'WhatsApp did not answer in time. Try again.' : PLAIN.NETWORK,
      );
    } finally {
      clearTimeout(timer);
    }

    const body: unknown = await response.json().catch(() => null);
    if (response.ok) return body;

    const providerCode = (body as { error?: { code?: unknown } } | null)?.error?.code;
    const numeric = typeof providerCode === 'number' ? providerCode : undefined;
    let code = classifyMetaError(numeric, response.status);
    if (code === 'PROVIDER_ERROR') code = fallback;
    this.logger.warn(`WhatsApp request to /${path.split('/').pop()} refused: HTTP ${response.status}, Meta code ${numeric ?? 'none'} → ${code}`);
    throw new WhatsAppSendError(code, PLAIN[code], numeric);
  }
}
