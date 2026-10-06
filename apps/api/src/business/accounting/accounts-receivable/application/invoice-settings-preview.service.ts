import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { PlatformFileService } from '../../../../platform/files/application/platform-file.service.js';
import {
  resolveInvoiceDocumentSettings,
  type UpdateInvoiceDocumentSettingsInput,
} from '../../accounting-core/application/invoice-document-settings.service.js';
import { toInvoiceDocumentSnapshot } from '../../accounting-core/infrastructure/invoice-document-policy.repository.js';
import { previewSampleInvoice } from './document-pdf/invoice-preview-sample.js';
import { InvoiceDocumentService } from './invoice-document.service.js';

/**
 * The live preview on Accounting → Invoice settings: the REAL invoice PDF, rendered from settings
 * that are not saved yet, the organisation's current logo and identity, and a sample invoice.
 * Settings are validated exactly as a save would validate them (422 INVOICE_SETTINGS_INVALID).
 * Nothing is stored — no file, no settings row.
 */
/** Renders allowed per user per window: typing debounced at 600ms stays far below it. */
export const PREVIEW_RENDERS_PER_WINDOW = 12;
export const PREVIEW_WINDOW_MS = 10_000;

@Injectable()
export class InvoiceSettingsPreviewService {
  /**
   * Recent render times per user. Rendering a PDF is CPU work on the shared API process, so a
   * caller looping on this endpoint gets 429 instead. In memory: the API runs as one process.
   */
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly tenancy: TenancyService,
    private readonly files: PlatformFileService,
    private readonly documents: InvoiceDocumentService,
  ) {}

  async render(
    identity: RequestIdentity,
    input: UpdateInvoiceDocumentSettingsInput,
    now: number = Date.now(),
  ): Promise<Buffer> {
    this.admit(identity.userId, now);
    // The whole draft is sent, so nothing falls back to the stored settings.
    const settings = toInvoiceDocumentSnapshot(resolveInvoiceDocumentSettings(input, null));
    const prisma = this.tenancy.getClient();
    const org = await prisma.organization.findUnique({
      where: { id: identity.activeOrganizationId },
      select: {
        name: true,
        logoFileId: true,
        legalAddress: true,
        taxRegistrationNumber: true,
        brandColorHex: true,
        invoiceTemplate: true,
      },
    });
    const logo = await this.files.readBytesForRendering(org?.logoFileId ?? null);

    return this.documents.render({
      ...previewSampleInvoice(new Date()),
      paymentAccounts: settings.paymentAccounts,
      notes: settings.notes,
      showBankDetails: settings.showBankDetails,
      showNotes: settings.showNotes,
      signatory: settings.signatory,
      footer: settings.footer,
      org: {
        name: org?.name ?? 'Invoice',
        legalAddress: org?.legalAddress ?? null,
        taxRegistrationNumber: org?.taxRegistrationNumber ?? null,
        brandColorHex: org?.brandColorHex ?? null,
        tagline: settings.tagline,
        template: org?.invoiceTemplate === 'COMPACT' ? 'COMPACT' : 'STANDARD',
        logo,
      },
    });
  }

  private admit(userId: string, now: number): void {
    const since = now - PREVIEW_WINDOW_MS;
    const times = (this.recent.get(userId) ?? []).filter((t) => t > since);
    if (times.length >= PREVIEW_RENDERS_PER_WINDOW) {
      this.recent.set(userId, times);
      throw new HttpException(
        { errorCode: 'PREVIEW_RATE_LIMITED', message: 'Too many previews at once — wait a moment.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    times.push(now);
    this.recent.set(userId, times);
    // Forget users idle for a whole window, so the map stays the size of the active users.
    for (const [user, list] of this.recent) {
      if (list[list.length - 1] <= since) this.recent.delete(user);
    }
  }
}
