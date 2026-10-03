import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

import type { ContactNumbers } from '../domain/invoice-whatsapp.js';

type Db =
  | Prisma.TransactionClient
  | Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>;

export interface InvoiceForWhatsApp {
  id: string;
  organizationId: string;
  clientId: string;
  invoiceNumber: string | null;
  postingStatus: string;
  documentStatus: string;
  currencyCode: string;
  totalAmount: string;
  /** Decimal string — what is still owed (reminders name this, not the total). */
  outstandingAmount: string;
  dueDate: Date | null;
  billingAddressSnapshot: unknown;
}

/** Tenant reads/writes for sending an invoice by WhatsApp (ADR-042 step 2). */
@Injectable()
export class InvoiceWhatsAppRepository {
  async findInvoice(
    db: Db,
    organizationId: string,
    id: string,
  ): Promise<InvoiceForWhatsApp | null> {
    const row = await db.clientInvoice.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        organizationId: true,
        clientId: true,
        invoiceNumber: true,
        postingStatus: true,
        documentStatus: true,
        currencyCode: true,
        totalAmount: true,
        outstandingAmount: true,
        dueDate: true,
        billingAddressSnapshot: true,
      },
    });
    return row
      ? {
          ...row,
          totalAmount: row.totalAmount.toFixed(2),
          outstandingAmount: row.outstandingAmount.toFixed(2),
        }
      : null;
  }

  async findClientName(db: Db, organizationId: string, clientId: string): Promise<string | null> {
    const row = await db.client.findFirst({
      where: { id: clientId, organizationId },
      select: { name: true },
    });
    return row?.name ?? null;
  }

  async findOrganizationName(db: Db, organizationId: string): Promise<string | null> {
    const row = await db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    return row?.name ?? null;
  }

  listContacts(db: Db, organizationId: string, clientId: string): Promise<ContactNumbers[]> {
    return db.clientContact.findMany({
      where: { clientId, client: { organizationId } },
      select: {
        id: true,
        name: true,
        role: true,
        phone: true,
        whatsappPhone: true,
        isPrimary: true,
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Records that the invoice reached the client through a message Rukna sent — the same
   * ClientInvoiceDelivery row a hand-recorded delivery writes (so the invoice lifecycle becomes SENT
   * and the collection timeline shows it). Exactly once per message: `outbound_message_id` is unique
   * and a repeat is skipped.
   */
  async recordMessageDelivery(
    db: Db,
    data: {
      organizationId: string;
      invoiceId: string;
      recipient: string;
      sentAt: Date;
      sentBy: string;
      outboundMessageId: string;
    },
  ): Promise<boolean> {
    const { count } = await db.clientInvoiceDelivery.createMany({
      data: [{ ...data, method: 'WHATSAPP', note: 'Sent through Rukna on WhatsApp' }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  /**
   * Removes the delivery a message recorded, once WhatsApp reports that message FAILED. Only the
   * system-generated row linked to that message — never a hand-recorded delivery. Returns how many
   * rows went (0 or 1).
   */
  async voidMessageDelivery(
    db: Db,
    organizationId: string,
    outboundMessageId: string,
  ): Promise<number> {
    const { count } = await db.clientInvoiceDelivery.deleteMany({
      where: { organizationId, outboundMessageId, method: 'WHATSAPP' },
    });
    return count;
  }

  /**
   * WhatsApp V1 step 4 — records that a reminder Rukna sent reached the client: the same
   * InvoiceFollowUp row a hand-recorded WhatsApp follow-up writes (so the collection timeline shows
   * it). Exactly once per message: `outbound_message_id` is unique and a repeat is skipped.
   */
  async recordReminderFollowUp(
    db: Db,
    data: {
      organizationId: string;
      invoiceId: string;
      note: string;
      occurredAt: Date;
      recordedBy: string;
      outboundMessageId: string;
    },
  ): Promise<boolean> {
    const { count } = await db.invoiceFollowUp.createMany({
      data: [{ ...data, method: 'WHATSAPP', contactPerson: null }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  /**
   * Removes the follow-up a reminder recorded, once WhatsApp reports that message FAILED. Only the
   * row linked to that message — never a hand-recorded follow-up. Returns how many rows went (0/1).
   */
  async voidReminderFollowUp(
    db: Db,
    organizationId: string,
    outboundMessageId: string,
  ): Promise<number> {
    const { count } = await db.invoiceFollowUp.deleteMany({
      where: { organizationId, outboundMessageId, method: 'WHATSAPP' },
    });
    return count;
  }
}
