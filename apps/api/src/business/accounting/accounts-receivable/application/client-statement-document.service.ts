import { Injectable } from '@nestjs/common';
import type { ClientStatement, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { PlatformFileService } from '../../../../platform/files/application/platform-file.service.js';
import { resolveInvoiceDocumentSnapshot } from '../../accounting-core/infrastructure/invoice-document-policy.repository.js';
import { ClientStatementRepository } from '../infrastructure/client-statement.repository.js';
import { ClientStatementService } from './client-statement.service.js';
import { StatementDocumentService, statementPdfFilename } from './statement-document.service.js';

export const STATEMENT_PDF_MIME_TYPE = 'application/pdf';

/**
 * ST-6 — the client's statement as a branded PDF: the statement for the period, drawn with the
 * organisation's logo, colour and footer contacts (the invoice settings). Rendered on every request
 * from the live figures; nothing is stored.
 */
@Injectable()
export class ClientStatementDocumentService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly statements: ClientStatementService,
    private readonly repo: ClientStatementRepository,
    private readonly renderer: StatementDocumentService,
    private readonly files: PlatformFileService,
  ) {}

  async render(
    identity: RequestIdentity,
    clientId: string,
    from?: string,
    to?: string,
  ): Promise<{ bytes: Buffer; filename: string; mimeType: string; statement: ClientStatement }> {
    const statement = await this.statements.statement(identity, clientId, from, to);
    const prisma = this.tenancy.getClient() as never;
    const org = await this.repo.findBranding(prisma, identity.activeOrganizationId);
    const [logo, settings] = await Promise.all([
      this.files.readBytesForRendering(org?.logoFileId ?? null),
      resolveInvoiceDocumentSnapshot(prisma, identity.activeOrganizationId),
    ]);
    const bytes = await this.renderer.render({
      statement,
      org: {
        name: org?.name ?? '',
        legalAddress: org?.legalAddress ?? null,
        taxRegistrationNumber: org?.taxRegistrationNumber ?? null,
        brandColorHex: org?.brandColorHex ?? null,
        template: org?.invoiceTemplate === 'COMPACT' ? 'COMPACT' : 'STANDARD',
        logo,
        tagline: settings?.tagline ?? null,
      },
      footer: settings?.footer ?? null,
    });
    return { bytes, filename: statementPdfFilename(statement), mimeType: STATEMENT_PDF_MIME_TYPE, statement };
  }
}
