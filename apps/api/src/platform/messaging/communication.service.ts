import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type MessagePurpose, type OutboundMessage } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { OutboundMessageView, RequestIdentity } from '@erp/types';

import { TenancyService } from '../tenancy/tenancy.service.js';
import { tenancyStorage } from '../tenancy/tenancy.context.js';
import { TransactionalAuditOutboxService } from '../audit-logs/application/transactional-audit-outbox.service.js';
import {
  OutboundMessageRepository,
  type Db,
} from './infrastructure/outbound-message.repository.js';
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

/** errorCode of a row a person marked as not delivered. */
export const MARKED_FAILED = 'MARKED_FAILED';
const MARKED_FAILED_MESSAGE =
  'Marked as not received after checking with the client. Send it again to retry.';

export interface ResolveUnknownInput {
  outcome: 'SENT' | 'FAILED';
  /** Why, in the person's words — kept in the audit log only. */
  note?: string | null;
}

/** Who a status hook acts for: the requesting user, or (webhooks) the message's creator. */
export interface MessageHookContext {
  organizationId: string;
  actorUserId: string;
}

export type MessageStatusHook = (
  tx: Prisma.TransactionClient,
  ctx: MessageHookContext,
  message: OutboundMessageView,
) => Promise<void>;

/**
 * Reactions of the feature that owns a resourceType (e.g. invoices) to its messages' status, run
 * INSIDE the transaction that changes the OutboundMessage status, so the feature's own record (an
 * invoice delivery) can never disagree with the message. Feature modules register them at start-up —
 * the platform never imports them (ARCH-BOUNDARY: platform must not depend on business modules).
 *
 *   onSent    the message reached the client's WhatsApp side: the send was accepted (SENT, or a
 *             webhook already moved it to DELIVERED / READ), a webhook confirmed a QUEUED / UNKNOWN
 *             row, or a person resolved UNKNOWN → SENT. May run more than once per message (each
 *             forward webhook): it must be idempotent.
 *   onFailed  a webhook reported the message FAILED (e.g. the number is not on WhatsApp) — possibly
 *             after onSent already ran. Not called for a send refused up front or a manual "not sent"
 *             of an UNKNOWN row (onSent never ran for those).
 */
export interface MessageStatusHooks {
  onSent?: MessageStatusHook;
  onFailed?: MessageStatusHook;
}

const REACHED: ReadonlySet<string> = new Set(['SENT', 'DELIVERED', 'READ']);

/**
 * ADR-044 phase 2 — asked just before a background message is sent: null = send it, or plain words
 * saying why it is no longer needed (e.g. the quotation was decided meanwhile). Registered by the
 * feature that owns the resourceType; the platform never imports it.
 */
export type DispatchGuard = (db: Db, message: OutboundMessage) => Promise<string | null>;

/** errorCode of a background row its feature withdrew before sending (DispatchGuard). */
export const NOT_NEEDED = 'NOT_NEEDED';
/** errorCode of a background row that could not be sent while it was still timely. */
export const EXPIRED = 'EXPIRED';
const EXPIRED_MESSAGE = 'Not sent: WhatsApp could not be reached while this alert was still useful.';

/** Background send policy (ADR-044 phase 2). */
export const BACKGROUND_MAX_ATTEMPTS = 5;
/** Wait after attempt n (1-based) before attempt n + 1. */
export const BACKGROUND_RETRY_DELAYS_MS = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000];
/** A claimed row is invisible to other dispatchers this long (a crash mid-send retries after it). */
export const BACKGROUND_LEASE_MS = 5 * 60_000;
/** An alert still unsent this long after it was queued is dropped (EXPIRED), not sent late. */
export const BACKGROUND_MAX_AGE_MS = 12 * 60 * 60_000;
/** Transient refusals worth another attempt; anything else definite fails at once. */
const RETRYABLE: ReadonlySet<string> = new Set(['RATE_LIMITED', 'NETWORK', 'PROVIDER_ERROR', 'NOT_CONFIGURED']);

const ACCEPTED_UNRECORDED_MESSAGE =
  'WhatsApp accepted this message but Rukna could not record it, so its delivery is not tracked.';

/** A loggable error code — never the error text (Prisma messages can echo values like numbers). */
export function errorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') return String(code);
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return 'UNKNOWN_ERROR';
}

export interface DispatchSummary {
  sent: number;
  retrying: number;
  failed: number;
  unknown: number;
  cancelled: number;
}

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
  private readonly statusHooks = new Map<string, MessageStatusHooks>();
  private readonly dispatchGuards = new Map<string, DispatchGuard>();

  constructor(
    private readonly tenancy: TenancyService,
    private readonly messages: OutboundMessageRepository,
    private readonly routes: OutboundMessageRouteRepository,
    private readonly whatsapp: WhatsAppClient,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  async sendWhatsAppTemplate(
    identity: RequestIdentity,
    input: SendWhatsAppTemplateInput,
  ): Promise<OutboundMessageView> {
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
  async listStale(
    identity: RequestIdentity,
    olderThanMinutes: number,
  ): Promise<OutboundMessageView[]> {
    if (!Number.isFinite(olderThanMinutes) || olderThanMinutes < 0) {
      throw new BadRequestException({
        code: 'MESSAGE_INVALID',
        field: 'olderThanMinutes',
        message: 'olderThanMinutes must be 0 or more',
      });
    }
    const before = new Date(Date.now() - olderThanMinutes * 60_000);
    const rows = await this.messages.listStale(
      this.tenancy.getClient(),
      identity.activeOrganizationId,
      STALE_STATUSES,
      before,
    );
    return rows.map(toView);
  }

  /**
   * The message already recorded under this idempotency key for this record, or null — so a caller
   * can answer a replay with the original message before re-checking whether a send is allowed now.
   */
  async findForResourceByKey(
    identity: RequestIdentity,
    idempotencyKey: string,
    resourceType: string,
    resourceId: string,
  ): Promise<OutboundMessageView | null> {
    const row = await this.messages.findByKey(
      this.tenancy.getClient(),
      identity.activeOrganizationId,
      idempotencyKey,
    );
    if (!row || row.resourceType !== resourceType || row.resourceId !== resourceId) return null;
    return toView(row);
  }

  async listForResource(
    identity: RequestIdentity,
    resourceType: string,
    resourceId: string,
  ): Promise<OutboundMessageView[]> {
    const rows = await this.messages.listForResource(
      this.tenancy.getClient(),
      identity.activeOrganizationId,
      resourceType,
      resourceId,
    );
    return rows.map(toView);
  }

  /** Registers the status hooks for one resourceType. A second registration is a wiring bug. */
  registerStatusHooks(resourceType: string, hooks: MessageStatusHooks): void {
    if (this.statusHooks.has(resourceType)) {
      throw new Error(`Message status hooks for '${resourceType}' are already registered`);
    }
    this.statusHooks.set(resourceType, hooks);
  }

  /** Registers the pre-send guard for one resourceType's background messages. */
  registerDispatchGuard(resourceType: string, guard: DispatchGuard): void {
    if (this.dispatchGuards.has(resourceType)) {
      throw new Error(`Dispatch guard for '${resourceType}' is already registered`);
    }
    this.dispatchGuards.set(resourceType, guard);
  }

  /** Whether WhatsApp sending is configured on this server (token + phone number id). */
  isWhatsAppConfigured(): boolean {
    return this.whatsapp.isConfigured();
  }

  /**
   * ADR-044 phase 2 — sends the background messages that are due, in the CURRENT tenant's context
   * (the dispatcher runs it per tenant inside `tenancyStorage.run`). Never inside a business
   * transaction, never on a request path.
   *
   *   claim (lease + attempt) → too old? EXPIRED → guard says not needed? NOT_NEEDED (FAILED) →
   *   send → SENT (provider id, route, then status — same order as a synchronous send).
   *   Definite transient refusal → stays QUEUED, retried after a back-off, FAILED after
   *   BACKGROUND_MAX_ATTEMPTS · definite permanent refusal → FAILED · no answer → UNKNOWN (never
   *   retried: it may have arrived).
   *
   * Not audited: there is no acting user (like webhook status changes); the row is the record.
   *
   * Review M1: rows are claimed ONE AT A TIME, immediately before each is sent, with the time read
   * at that claim — so a slow send (up to the client's 20 s timeout) never eats into the lease of a
   * row claimed earlier, and a second dispatcher (another replica) can never claim a row this one
   * is still about to send. `now` pins the clock for tests; production passes nothing.
   */
  async dispatchDue(now?: Date, limit = 50): Promise<DispatchSummary> {
    const summary: DispatchSummary = { sent: 0, retrying: 0, failed: 0, unknown: 0, cancelled: 0 };
    const db = this.tenancy.getClient();
    for (let i = 0; i < limit; i++) {
      const at = now ?? new Date();
      const [row] = await this.messages.claimDue(db, at, new Date(at.getTime() + BACKGROUND_LEASE_MS), 1);
      if (!row) break;
      try {
        summary[await this.dispatchOne(db, row, at)] += 1;
      } catch (error) {
        // A bug or a database error on one row must not stop the others; the lease retries it.
        this.logger.error(
          `Background ${row.purpose} message ${row.id} not dispatched: ${errorCode(error)}`,
        );
      }
    }
    return summary;
  }

  /**
   * A person settles an UNKNOWN message after checking with the client (WhatsApp never confirmed the
   * send). SENT → the row counts as sent, `sentAt` = the time of the resolve (the real send time is
   * unknowable), and the owning feature's onSent hook runs in the same transaction with the resolver
   * as actor; FAILED → the row is FAILED (errorCode MARKED_FAILED) and the caller may send
   * again under a new idempotency key. Only an UNKNOWN row can be resolved (409 otherwise). Audited.
   */
  async resolveUnknown(
    identity: RequestIdentity,
    id: string,
    input: ResolveUnknownInput,
  ): Promise<OutboundMessageView> {
    if (input.outcome !== 'SENT' && input.outcome !== 'FAILED') {
      throw new BadRequestException({
        code: 'MESSAGE_INVALID',
        field: 'outcome',
        message: 'outcome must be SENT or FAILED',
      });
    }
    const db = this.tenancy.getClient();
    const existing = await this.messages.findById(db, id);
    if (!existing || existing.organizationId !== identity.activeOrganizationId) {
      throw new NotFoundException({
        errorCode: 'MESSAGE_NOT_FOUND',
        message: 'Message not found.',
      });
    }
    const notUnknown = () =>
      new ConflictException({
        errorCode: 'MESSAGE_NOT_UNKNOWN',
        message:
          'Only a message WhatsApp never confirmed can be marked by hand. Reload to see its current status.',
      });
    if (existing.status !== 'UNKNOWN') throw notUnknown();

    const now = new Date();
    const data: Prisma.OutboundMessageUpdateManyMutationInput =
      input.outcome === 'SENT'
        ? { status: 'SENT', sentAt: now, errorCode: null, errorMessage: null }
        : {
            status: 'FAILED',
            failedAt: now,
            errorCode: MARKED_FAILED,
            errorMessage: MARKED_FAILED_MESSAGE,
          };

    const settled = await db.$transaction(async (tx) => {
      if (!(await this.messages.resolveUnknown(tx, id, data))) throw notUnknown();
      const row = await this.messages.findById(tx, id);
      if (!row) throw notUnknown();
      await this.auditOutbox.record(tx as Prisma.TransactionClient, {
        organizationId: row.organizationId,
        actorUserId: identity.userId,
        action: `whatsapp.resolved-${input.outcome === 'SENT' ? 'sent' : 'failed'}`,
        resourceType: OUTBOUND_MESSAGE_AUDIT_RESOURCE,
        resourceId: row.id,
        sourceCommand: 'communication.resolve-unknown',
        eventType: 'outbound-message.resolved',
        idempotencyKey: `outbound-message.resolved:${row.id}`,
        before: { status: 'UNKNOWN' },
        after: {
          status: row.status,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          recipient: maskPhone(row.recipient),
          ...(input.note?.trim() ? { note: input.note.trim().slice(0, 500) } : {}),
        },
      });
      if (input.outcome === 'SENT') {
        await this.runHook('onSent', tx as Prisma.TransactionClient, row, identity.userId);
      }
      return row;
    });
    return toView(settled);
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
    const data: Prisma.OutboundMessageUpdateManyMutationInput = {
      status,
      [STATUS_TIMESTAMP[webhookStatus]]: at,
    };
    if (status === 'FAILED') {
      const first = update.errors?.[0];
      const code = typeof first?.code === 'number' ? first.code : undefined;
      data.errorCode = code !== undefined ? String(code) : 'PROVIDER_ERROR';
      data.errorMessage = describeWhatsAppError(classifyMetaError(code));
    }

    const applied = await db.$transaction(async (tx) => {
      const ok = await this.messages.applyStatus(
        tx,
        update.providerMessageId,
        statusesThatAccept(status),
        data,
      );
      if (!ok) return false;
      await this.messages.fillMissingTimestamps(
        tx,
        update.providerMessageId,
        IMPLIED_TIMESTAMPS[webhookStatus],
        at,
      );
      if (this.statusHooks.size > 0) {
        const row = await this.messages.findByProviderId(tx, update.providerMessageId);
        // No user behind a webhook: the message's creator is the actor (as for its own send).
        if (row) {
          await this.runHook(
            status === 'FAILED' ? 'onFailed' : 'onSent',
            tx as Prisma.TransactionClient,
            row,
            row.createdBy,
          );
        }
      }
      return true;
    });
    if (applied) return 'applied';
    return (await this.messages.findByProviderId(db, update.providerMessageId))
      ? 'ignored'
      : 'not_found';
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
            mediaId: await this.whatsapp.uploadMedia(
              input.document.bytes,
              input.document.mimeType,
              input.document.filename,
            ),
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
      this.logger.warn(
        `WhatsApp ${row.purpose} message ${row.id} to ${maskPhone(row.recipient)} ${outcome}: ${failure.code}`,
      );
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
      // A webhook may already have failed it; only a message that got through counts as sent.
      if (REACHED.has(updated.status)) {
        await this.runHook('onSent', tx as Prisma.TransactionClient, updated, identity.userId);
      }
      return updated;
    });
    return toView(sent);
  }

  private async dispatchOne(
    db: ReturnType<TenancyService['getClient']>,
    row: OutboundMessage,
    now: Date,
  ): Promise<keyof DispatchSummary> {
    const fail = async (code: string, message: string) => {
      await db.$transaction(async (tx) => {
        await this.messages.markFailed(tx, row.id, code, message, now);
        await this.messages.clearSchedule(tx, row.id);
      });
    };

    if (now.getTime() - row.queuedAt.getTime() > BACKGROUND_MAX_AGE_MS) {
      await fail(EXPIRED, EXPIRED_MESSAGE);
      return 'failed';
    }
    // Review L2: claims count attempts, so a row claimed again after its cap (e.g. a process that
    // kept dying mid-send) is settled with its last error instead of being sent once more.
    if (row.attemptCount > BACKGROUND_MAX_ATTEMPTS) {
      await fail(row.errorCode ?? 'PROVIDER_ERROR', row.errorMessage ?? describeWhatsAppError('PROVIDER_ERROR'));
      return 'failed';
    }
    const guard = this.dispatchGuards.get(row.resourceType);
    const notNeeded = guard ? await guard(db, row) : null;
    if (notNeeded) {
      await fail(NOT_NEEDED, notNeeded);
      return 'cancelled';
    }
    if (!row.templateName || !row.templateLanguage) {
      await fail('TEMPLATE_NOT_APPROVED', describeWhatsAppError('TEMPLATE_NOT_APPROVED'));
      return 'failed';
    }
    const params = row.templateParams as { body?: unknown; buttonUrlSuffix?: unknown } | null;
    const body = Array.isArray(params?.body)
      ? params.body.filter((p): p is string => typeof p === 'string')
      : [];
    const buttonUrlSuffix =
      typeof params?.buttonUrlSuffix === 'string' && params.buttonUrlSuffix ? params.buttonUrlSuffix : undefined;

    let providerMessageId: string;
    try {
      ({ providerMessageId } = await this.whatsapp.sendTemplate({
        to: row.recipient,
        templateName: row.templateName,
        language: row.templateLanguage,
        bodyParams: body,
        ...(buttonUrlSuffix ? { buttonUrlSuffix } : {}),
      }));
    } catch (error) {
      const failure =
        error instanceof WhatsAppSendError
          ? error
          : new WhatsAppSendError('PROVIDER_ERROR', describeWhatsAppError('PROVIDER_ERROR'));
      const where = `Background ${row.purpose} message ${row.id} to ${maskPhone(row.recipient)}`;
      if (failure.outcomeUnknown) {
        await db.$transaction(async (tx) => {
          await this.messages.markUnknown(tx, row.id, OUTCOME_UNKNOWN, OUTCOME_UNKNOWN_MESSAGE);
          await this.messages.clearSchedule(tx, row.id);
        });
        this.logger.warn(`${where} unknown: ${failure.code}`);
        return 'unknown';
      }
      if (
        error instanceof WhatsAppSendError &&
        RETRYABLE.has(failure.code) &&
        row.attemptCount < BACKGROUND_MAX_ATTEMPTS
      ) {
        const delay =
          BACKGROUND_RETRY_DELAYS_MS[Math.min(row.attemptCount, BACKGROUND_RETRY_DELAYS_MS.length) - 1];
        await this.messages.scheduleRetry(db, row.id, new Date(now.getTime() + delay), failure.code, failure.message);
        this.logger.warn(`${where} attempt ${row.attemptCount} refused (${failure.code}); retrying`);
        return 'retrying';
      }
      await fail(failure.code, failure.message);
      this.logger.warn(`${where} failed after ${row.attemptCount} attempt(s): ${failure.code}`);
      if (!(error instanceof WhatsAppSendError)) throw error;
      return 'failed';
    }

    // Same order as a synchronous send (see deliver): provider id → route → SENT.
    try {
      await this.messages.attachProviderId(db, row.id, providerMessageId);
      await this.recordRoute(providerMessageId);
      await db.$transaction(async (tx) => {
        await this.messages.markSent(tx, row.id, providerMessageId, new Date());
        await this.messages.clearSchedule(tx, row.id);
      });
    } catch (error) {
      // Review L2: Meta accepted it — it must never be sent again after the lease. Settle it as
      // UNKNOWN (best effort: if this write fails too, the error is logged).
      this.logger.error(`Background ${row.purpose} message ${row.id} sent but not recorded: ${errorCode(error)}`);
      try {
        await this.messages.settleAcceptedUnrecorded(db, row.id, OUTCOME_UNKNOWN, ACCEPTED_UNRECORDED_MESSAGE);
      } catch (settleError) {
        this.logger.error(`Background message ${row.id} could not be settled: ${errorCode(settleError)}`);
      }
      return 'unknown';
    }
    return 'sent';
  }

  private async runHook(
    kind: keyof MessageStatusHooks,
    tx: Prisma.TransactionClient,
    row: OutboundMessage,
    actorUserId: string,
  ): Promise<void> {
    const hook = this.statusHooks.get(row.resourceType)?.[kind];
    if (hook) await hook(tx, { organizationId: row.organizationId, actorUserId }, toView(row));
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

  private audit(
    tx: Db,
    identity: RequestIdentity,
    row: OutboundMessage,
    outcome: 'sent' | 'failed' | 'unknown',
  ): Promise<void> {
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
  const bad = (field: string, why: string) =>
    new BadRequestException({ code: 'MESSAGE_INVALID', field, message: why });
  if (!E164_PATTERN.test(input.recipient?.trim() ?? ''))
    throw bad('recipient', 'Recipient must be an E.164 number, e.g. +252612345678');
  if (!input.idempotencyKey?.trim() || input.idempotencyKey.length > 200)
    throw bad('idempotencyKey', 'An idempotency key (≤ 200 chars) is required');
  if (!input.templateName?.trim()) throw bad('templateName', 'A template name is required');
  if (!input.language?.trim()) throw bad('language', 'A template language is required');
  if (!input.resourceType?.trim() || !input.resourceId?.trim())
    throw bad('resource', 'resourceType and resourceId are required');
  if (!Array.isArray(input.bodyParams) || input.bodyParams.some((p) => typeof p !== 'string')) {
    throw bad('bodyParams', 'bodyParams must be a list of strings');
  }
  if (
    input.document &&
    (!input.document.bytes?.length || !input.document.mimeType || !input.document.filename)
  ) {
    throw bad('document', 'A document needs bytes, a MIME type and a filename');
  }
}

/** One idempotency key = one intended message: same purpose, same record. */
function assertSameIntent(row: OutboundMessage, input: SendWhatsAppTemplateInput): void {
  if (
    row.purpose !== input.purpose ||
    row.resourceType !== input.resourceType ||
    row.resourceId !== input.resourceId
  ) {
    throw new ConflictException({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'This idempotency key was already used for a different message.',
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
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
