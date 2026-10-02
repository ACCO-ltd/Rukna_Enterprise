import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type MessagePurpose, type OutboundMessage } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { OutboundMessageView, RequestIdentity } from '@erp/types';

import { TenancyService } from '../tenancy/tenancy.service.js';
import { tenancyStorage } from '../tenancy/tenancy.context.js';
import { TransactionalAuditOutboxService } from '../audit-logs/application/transactional-audit-outbox.service.js';
import { OutboundMessageRepository, type Db } from './infrastructure/outbound-message.repository.js';
import { OutboundMessageRouteRepository } from './infrastructure/outbound-message-route.repository.js';
import {
  E164_PATTERN,
  IMPLIED_TIMESTAMPS,
  STALE_STATUSES,
  STATUS_TIMESTAMP,
  fromMetaStatus,
  statusesThatAccept,
} from './domain/message-status.js';
import {
  WhatsAppClient,
  WhatsAppSendError,
  classifyMetaError,
  describeWhatsAppError,
  maskPhone,
} from './whatsapp/whatsapp.client.js';

export const OUTBOUND_MESSAGE_AUDIT_RESOURCE = 'outbound-message';

/** errorCode of an UNKNOWN row: the send went out, Meta never confirmed it. */
export const OUTCOME_UNKNOWN = 'OUTCOME_UNKNOWN';
const OUTCOME_UNKNOWN_MESSAGE =
  'WhatsApp did not confirm this message, so it may or may not have reached the client. Check with the client before sending it again.';

export interface SendWhatsAppTemplateInput {
  purpose: MessagePurpose;
  clientId?: string | null;
  /** E.164 with '+', e.g. '+252612345678'. */
  recipient: string;
  /** e.g. 'client_invoice' | 'payment_receipt'. */
  resourceType: string;
  resourceId: string;
  templateName: string;
  language: string;
  /** Values for the template body's {{1}}, {{2}}, … in order. */
  bodyParams: string[];
  /** Sent as the template's DOCUMENT header (uploaded to Meta first; no public link). */
  document?: { bytes: Buffer; mimeType: string; filename: string };
  /** Caller-chosen, stable per intended message (e.g. `invoice-send:{invoiceId}:{n}`). */
  idempotencyKey: string;
}

/** A delivery-status update from Meta's webhook. */
export interface MessageStatusUpdate {
  providerMessageId: string;
  /** Meta's word: 'sent' | 'delivered' | 'read' | 'failed' (others are ignored). */
  status: string;
  /** Unix seconds as Meta sends it; falls back to now when absent/invalid. */
  timestamp?: string;
  errors?: Array<{ code?: number; title?: string }>;
}

export type StatusUpdateOutcome = 'applied' | 'ignored' | 'not_found';

/**
 * ADR-042 phase 2 — the channel-agnostic communication core. Callers (send invoice / receipt /
 * reminders) ask for a message; this records it (OutboundMessage), sends it through the channel
 * client, and keeps its status from the provider's webhooks.
 *
 * Idempotency: one row per (organization, idempotencyKey). A key reused for a different purpose or
 * record is a caller bug → 409 IDEMPOTENCY_KEY_REUSED.
 *   - Existing row not FAILED → returned unchanged; nothing is sent again. This includes a row stuck
 *     in QUEUED (the process died mid-send) or UNKNOWN (Meta never answered the send): we cannot
 *     know whether Meta accepted it, so we do not risk a duplicate message to a client. Such rows
 *     surface through `listStale`.
 *   - Existing row FAILED → a retry REUSES the row (re-armed to QUEUED with this request's recipient
 *     and template), so a resource keeps one record per intended message and its failure history
 *     lives in the audit log. The re-arm is conditional, so two concurrent retries send once.
 *
 * Provider failures never throw: a definite refusal makes the row FAILED (retryable), an unanswered
 * send makes it UNKNOWN (not retryable), each with a code and plain-words message, and the row is
 * returned for the caller to surface. Only invalid input (a programming error) throws.
 */
@Injectable()
export class CommunicationService {
  private readonly logger = new Logger(CommunicationService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly messages: OutboundMessageRepository,
    private readonly routes: OutboundMessageRouteRepository,
    private readonly whatsapp: WhatsAppClient,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  async sendWhatsAppTemplate(identity: RequestIdentity, input: SendWhatsAppTemplateInput): Promise<OutboundMessageView> {
    validate(input);
    const db = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const details = {
      recipient: input.recipient.trim(),
      clientId: input.clientId ?? null,
      templateName: input.templateName.trim(),
      templateLanguage: input.language.trim(),
      createdBy: identity.userId,
    };

    let row = await this.messages.findByKey(db, orgId, input.idempotencyKey);
    if (row) {
      assertSameIntent(row, input);
      if (row.status !== 'FAILED') return toView(row);
      const claimed = await this.messages.rearmFailed(db, row.id, details);
      const current = await this.messages.findById(db, row.id);
      if (!claimed || !current) return toView(current ?? row);
      row = current;
    } else {
      try {
        row = await this.messages.create(db, {
          ...details,
          organizationId: orgId,
          channel: 'WHATSAPP',
          purpose: input.purpose,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // A concurrent request with the same key won the insert: return its row, send nothing.
        const winner = await this.messages.findByKey(db, orgId, input.idempotencyKey);
        if (!winner) throw error;
        assertSameIntent(winner, input);
        return toView(winner);
      }
    }

    return this.deliver(db, identity, row, input);
  }

  /**
   * Messages with no provider confirmation (QUEUED or UNKNOWN) queued more than `olderThanMinutes`
   * ago, oldest first — the ones a person must check by hand before any re-send.
   */
  async listStale(identity: RequestIdentity, olderThanMinutes: number): Promise<OutboundMessageView[]> {
    if (!Number.isFinite(olderThanMinutes) || olderThanMinutes < 0) {
      throw new BadRequestException({ code: 'MESSAGE_INVALID', field: 'olderThanMinutes', message: 'olderThanMinutes must be 0 or more' });
    }
    const before = new Date(Date.now() - olderThanMinutes * 60_000);
    const rows = await this.messages.listStale(this.tenancy.getClient(), identity.activeOrganizationId, STALE_STATUSES, before);
    return rows.map(toView);
  }

  async listForResource(identity: RequestIdentity, resourceType: string, resourceId: string): Promise<OutboundMessageView[]> {
    const rows = await this.messages.listForResource(this.tenancy.getClient(), identity.activeOrganizationId, resourceType, resourceId);
    return rows.map(toView);
  }

  /**
   * Webhook status update, run inside the owning tenant's context. Monotonic and idempotent (rules
   * in domain/message-status.ts): a repeat or a regression is 'ignored', an unknown id 'not_found'.
   */
  async applyStatusUpdate(update: MessageStatusUpdate): Promise<StatusUpdateOutcome> {
    const db = this.tenancy.getClient();
    const status = fromMetaStatus(update.status);
    if (!status) return 'ignored';

    if (!(status in STATUS_TIMESTAMP)) return 'ignored';
    const webhookStatus = status as keyof typeof STATUS_TIMESTAMP;

    const at = parseUnixSeconds(update.timestamp);
    const data: Prisma.OutboundMessageUpdateManyMutationInput = { status, [STATUS_TIMESTAMP[webhookStatus]]: at };
    if (status === 'FAILED') {
      const first = update.errors?.[0];
      const code = typeof first?.code === 'number' ? first.code : undefined;
      data.errorCode = code !== undefined ? String(code) : 'PROVIDER_ERROR';
      data.errorMessage = describeWhatsAppError(classifyMetaError(code));
    }

    const applied = await this.messages.applyStatus(db, update.providerMessageId, statusesThatAccept(status), data);
    if (applied) {
      await this.messages.fillMissingTimestamps(db, update.providerMessageId, IMPLIED_TIMESTAMPS[webhookStatus], at);
      return 'applied';
    }
    return (await this.messages.findByProviderId(db, update.providerMessageId)) ? 'ignored' : 'not_found';
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private async deliver(
    db: ReturnType<TenancyService['getClient']>,
    identity: RequestIdentity,
    row: OutboundMessage,
    input: SendWhatsAppTemplateInput,
  ): Promise<OutboundMessageView> {
    let providerMessageId: string;
    try {
      const document = input.document
        ? {
            mediaId: await this.whatsapp.uploadMedia(input.document.bytes, input.document.mimeType, input.document.filename),
            filename: input.document.filename,
          }
        : undefined;
      ({ providerMessageId } = await this.whatsapp.sendTemplate({
        to: row.recipient,
        templateName: input.templateName.trim(),
        language: input.language.trim(),
        bodyParams: input.bodyParams,
        document,
      }));
    } catch (error) {
      const failure =
        error instanceof WhatsAppSendError
          ? error
          : new WhatsAppSendError('PROVIDER_ERROR', describeWhatsAppError('PROVIDER_ERROR'));
      const outcome = failure.outcomeUnknown ? 'unknown' : 'failed';
      const settled = await db.$transaction(async (tx) => {
        const updated =
          outcome === 'unknown'
            ? await this.messages.markUnknown(tx, row.id, OUTCOME_UNKNOWN, OUTCOME_UNKNOWN_MESSAGE)
            : await this.messages.markFailed(tx, row.id, failure.code, failure.message, new Date());
        await this.audit(tx, identity, updated, outcome);
        return updated;
      });
      this.logger.warn(`WhatsApp ${row.purpose} message ${row.id} to ${maskPhone(row.recipient)} ${outcome}: ${failure.code}`);
      if (!(error instanceof WhatsAppSendError)) throw error; // a bug, not a provider failure
      return toView(settled);
    }

    // Order matters for a fast webhook: (1) the provider id goes on the row, (2) the platform route
    // is written, (3) the row is marked SENT. Once the route exists the row is findable by provider
    // id, and a webhook landing before (3) applies from QUEUED (markSent then keeps the later status).
    // A route failure must not turn a message Meta accepted into FAILED: it is logged and only costs
    // this message's status updates.
    await this.messages.attachProviderId(db, row.id, providerMessageId);
    await this.recordRoute(providerMessageId);

    const sent = await db.$transaction(async (tx) => {
      const updated = await this.messages.markSent(tx, row.id, providerMessageId, new Date());
      await this.audit(tx, identity, updated, 'sent');
      return updated;
    });
    return toView(sent);
  }

  private async recordRoute(providerMessageId: string): Promise<void> {
    const tenantId = tenancyStorage.getStore()?.tenantId;
    try {
      if (!tenantId) throw new Error('no tenant context');
      await this.routes.record(providerMessageId, tenantId);
    } catch (error) {
      this.logger.error(
        `Could not record the webhook route for ${providerMessageId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private audit(tx: Db, identity: RequestIdentity, row: OutboundMessage, outcome: 'sent' | 'failed' | 'unknown'): Promise<void> {
    return this.auditOutbox.record(tx as Prisma.TransactionClient, {
      organizationId: row.organizationId,
      actorUserId: identity.userId,
      action: `whatsapp.${outcome}`,
      resourceType: OUTBOUND_MESSAGE_AUDIT_RESOURCE,
      resourceId: row.id,
      sourceCommand: 'communication.send-whatsapp-template',
      eventType: `outbound-message.${outcome}`,
      idempotencyKey: `outbound-message.${outcome}:${row.id}:${randomUUID()}`,
      // No amounts, no full phone number.
      after: {
        channel: row.channel,
        purpose: row.purpose,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        clientId: row.clientId,
        recipient: maskPhone(row.recipient),
        templateName: row.templateName,
        status: row.status,
        ...(row.errorCode ? { errorCode: row.errorCode } : {}),
      },
    });
  }
}

function validate(input: SendWhatsAppTemplateInput): void {
  const bad = (field: string, why: string) => new BadRequestException({ code: 'MESSAGE_INVALID', field, message: why });
  if (!E164_PATTERN.test(input.recipient?.trim() ?? '')) throw bad('recipient', 'Recipient must be an E.164 number, e.g. +252612345678');
  if (!input.idempotencyKey?.trim() || input.idempotencyKey.length > 200) throw bad('idempotencyKey', 'An idempotency key (≤ 200 chars) is required');
  if (!input.templateName?.trim()) throw bad('templateName', 'A template name is required');
  if (!input.language?.trim()) throw bad('language', 'A template language is required');
  if (!input.resourceType?.trim() || !input.resourceId?.trim()) throw bad('resource', 'resourceType and resourceId are required');
  if (!Array.isArray(input.bodyParams) || input.bodyParams.some((p) => typeof p !== 'string')) {
    throw bad('bodyParams', 'bodyParams must be a list of strings');
  }
  if (input.document && (!input.document.bytes?.length || !input.document.mimeType || !input.document.filename)) {
    throw bad('document', 'A document needs bytes, a MIME type and a filename');
  }
}

/** One idempotency key = one intended message: same purpose, same record. */
function assertSameIntent(row: OutboundMessage, input: SendWhatsAppTemplateInput): void {
  if (row.purpose !== input.purpose || row.resourceType !== input.resourceType || row.resourceId !== input.resourceId) {
    throw new ConflictException({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'This idempotency key was already used for a different message.',
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002';
}

function parseUnixSeconds(value: string | undefined): Date {
  const seconds = Number(value);
  return value && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toView(row: OutboundMessage): OutboundMessageView {
  return {
    id: row.id,
    channel: row.channel,
    purpose: row.purpose,
    clientId: row.clientId,
    recipient: row.recipient,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    templateName: row.templateName,
    templateLanguage: row.templateLanguage,
    status: row.status,
    queuedAt: row.queuedAt.toISOString(),
    sentAt: iso(row.sentAt),
    deliveredAt: iso(row.deliveredAt),
    readAt: iso(row.readAt),
    failedAt: iso(row.failedAt),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}
