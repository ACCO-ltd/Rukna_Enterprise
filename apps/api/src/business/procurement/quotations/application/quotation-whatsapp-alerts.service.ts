import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { StaffAlertLogEntry } from '@erp/types';

import { CommunicationService, errorCode } from '../../../../platform/messaging/communication.service.js';
import {
  OutboundMessageRepository,
  type NewBackgroundMessage,
} from '../../../../platform/messaging/infrastructure/outbound-message.repository.js';
import { resolveWhatsAppTemplate } from '../../../../platform/messaging/whatsapp/whatsapp-templates.js';
import { E164_PATTERN } from '../../../../platform/messaging/domain/message-status.js';
import { loadActorNames } from '../../../../platform/users/application/actor-names.js';
import { maskStaffPhone } from '../../../../platform/users/domain/staff-whatsapp.policy.js';
import type { Db } from '../infrastructure/quotation-request.repository.js';
import {
  QUOTATION_MESSAGE_RESOURCE,
  alertBodyParams,
  alertIdempotencyKey,
  type QuotationAlertFacts,
  type QuotationAlertPurpose,
} from '../domain/quotation-whatsapp.policy.js';

/** Env kill switch (default off): when not exactly 'true', nothing is queued. */
export const QUOTATION_WHATSAPP_ENABLED = 'QUOTATION_WHATSAPP_ENABLED';
/** Optional ISO instant: the SLA chaser ignores rounds sent before it (review M3). */
export const QUOTATION_WHATSAPP_SINCE = 'QUOTATION_WHATSAPP_SINCE';

/**
 * A value, or how to read it. Readers run INSIDE the savepoint and only when alerts are on
 * (review L1): with the switch off a business transaction does no extra work, and a failed read
 * is rolled back with the alert, never aborting the command.
 */
export type Lazy<T> = T | (() => Promise<T>);
const resolve = <T>(value: Lazy<T>): Promise<T> =>
  typeof value === 'function' ? (value as () => Promise<T>)() : Promise.resolve(value);

export interface QueueAlertInput {
  organizationId: string;
  requestId: string;
  purpose: QuotationAlertPurpose;
  /** The round segment of the idempotency key (decision round, send count or award instant). */
  round: Lazy<string>;
  recipientUserIds: string[];
  facts: Lazy<QuotationAlertFacts>;
  /** Who caused it (the acting user); the SLA job passes the request's creator. */
  actorUserId: string;
}

/**
 * ADR-044 phase 2 — WhatsApp alerts to staff about quotation requests. This class only QUEUES them
 * (OutboundMessage rows, sent by the platform's background dispatcher) and answers the delivery log;
 * nothing here ever calls Meta, so a quotation command never waits on WhatsApp.
 *
 * Who gets one: the recipients the caller resolved (the same people as the in-app notification),
 * narrowed to ACTIVE users who switched WhatsApp alerts on and have a valid number. Everyone keeps
 * the in-app notification regardless.
 *
 * Queued in the caller's transaction (atomic with the event) under a SAVEPOINT, so even a failed
 * insert is rolled back alone and logged — an alert can never fail or block the business action.
 * Nothing is queued while QUOTATION_WHATSAPP_ENABLED is not 'true', or while WhatsApp itself is not
 * configured on the server (logged once).
 */
@Injectable()
export class QuotationWhatsAppAlerts {
  private readonly logger = new Logger(QuotationWhatsAppAlerts.name);
  private warnedUnconfigured = false;
  private warnedSince = false;

  constructor(
    private readonly config: ConfigService,
    private readonly communication: CommunicationService,
    private readonly messages: OutboundMessageRepository,
  ) {}

  /** The kill switch alone (QUOTATION_WHATSAPP_ENABLED === 'true'). */
  switchedOn(): boolean {
    return this.config.get<string>(QUOTATION_WHATSAPP_ENABLED) === 'true';
  }

  /** QUOTATION_WHATSAPP_SINCE as a date; null when unset or unparseable (logged once). */
  chaseSince(): Date | null {
    const raw = this.config.get<string>(QUOTATION_WHATSAPP_SINCE)?.trim();
    if (!raw) return null;
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) {
      if (!this.warnedSince) {
        this.warnedSince = true;
        this.logger.warn(`${QUOTATION_WHATSAPP_SINCE} is not a valid date — ignored (3-day lookback only)`);
      }
      return null;
    }
    return at;
  }

  /** Whether alerts are queued at all right now (kill switch on and WhatsApp configured). */
  enabled(): boolean {
    if (!this.switchedOn()) return false;
    if (!this.communication.isWhatsAppConfigured()) {
      if (!this.warnedUnconfigured) {
        this.warnedUnconfigured = true;
        this.logger.log('QUOTATION_WHATSAPP_ENABLED is on but WhatsApp is not configured — no alerts queued');
      }
      return false;
    }
    return true;
  }

  /**
   * Queues one alert per opted-in recipient inside `tx` (a business or job transaction). Returns
   * how many new rows were queued (0 for repeats, when disabled, or when nobody opted in).
   */
  async queue(tx: Prisma.TransactionClient, input: QueueAlertInput): Promise<number> {
    if (!this.enabled() || input.recipientUserIds.length === 0) return 0;
    await tx.$executeRawUnsafe('SAVEPOINT quotation_whatsapp_alert');
    try {
      const queued = await this.insert(tx, input);
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT quotation_whatsapp_alert');
      return queued;
    } catch (error) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT quotation_whatsapp_alert');
      // Review L9: the error code only — a database message can echo values such as phone numbers.
      this.logger.error(`Quotation ${input.purpose} WhatsApp alert for ${input.requestId} not queued: ${errorCode(error)}`);
      return 0;
    }
  }

  /** The request's alert log, oldest first — names, masked numbers, status; no text, no amounts. */
  async deliveryLog(db: Db, organizationId: string, requestId: string): Promise<StaffAlertLogEntry[]> {
    const rows = await this.messages.listBackgroundForResource(db, organizationId, QUOTATION_MESSAGE_RESOURCE, requestId);
    if (rows.length === 0) return [];
    const name = await loadActorNames(db, rows.map((r) => r.recipientUserId ?? ''));
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return rows.map((row) => ({
      id: row.id,
      recipientName: name(row.recipientUserId ?? ''),
      recipientPhoneMasked: maskStaffPhone(row.recipient),
      purpose: row.purpose as StaffAlertLogEntry['purpose'],
      status: row.status,
      queuedAt: row.queuedAt.toISOString(),
      sentAt: iso(row.sentAt),
      deliveredAt: iso(row.deliveredAt),
      readAt: iso(row.readAt),
      failedAt: iso(row.failedAt),
      failureReason: row.status === 'SENT' || row.status === 'DELIVERED' || row.status === 'READ' ? null : row.errorMessage,
    }));
  }

  private async insert(tx: Prisma.TransactionClient, input: QueueAlertInput): Promise<number> {
    const template = resolveWhatsAppTemplate(this.config, input.purpose);
    if (!template) return 0;
    const users = await tx.user.findMany({
      where: {
        id: { in: [...new Set(input.recipientUserIds)] },
        // Review L4: an ACTIVE membership of this organisation, not just the user's home org.
        memberships: { some: { organizationId: input.organizationId, status: 'ACTIVE', removedAt: null } },
        status: 'ACTIVE',
        whatsappAlertsEnabled: true,
        whatsappPhone: { not: null },
      },
      select: { id: true, whatsappPhone: true },
    });
    if (users.length === 0) return 0;
    const body = alertBodyParams(input.purpose, await resolve(input.facts));
    const round = await resolve(input.round);
    const rows: NewBackgroundMessage[] = users
      .filter((u): u is { id: string; whatsappPhone: string } => !!u.whatsappPhone && E164_PATTERN.test(u.whatsappPhone))
      .map((u) => ({
        organizationId: input.organizationId,
        purpose: input.purpose,
        recipient: u.whatsappPhone,
        recipientUserId: u.id,
        resourceType: QUOTATION_MESSAGE_RESOURCE,
        resourceId: input.requestId,
        templateName: template.name,
        templateLanguage: template.language,
        templateParams: { body, buttonUrlSuffix: input.requestId },
        idempotencyKey: alertIdempotencyKey(input.requestId, input.purpose, round, u.id),
        createdBy: input.actorUserId,
      }));
    return this.messages.enqueueMany(tx, rows, new Date());
  }
}
