import { Injectable } from '@nestjs/common';
import type { DocumentReadingKind, Prisma } from '@prisma/client';

import { TenancyService } from '../../tenancy/tenancy.service.js';

/** Step 7 — the photo reader's switch and its log. */
@Injectable()
export class DocumentReaderRepository {
  constructor(private readonly tenancy: TenancyService) {}

  async enabled(organizationId: string): Promise<boolean> {
    const policy = await this.tenancy.getClient().documentReaderPolicy.findUnique({ where: { organizationId }, select: { enabled: true } });
    return policy?.enabled ?? false;
  }

  setEnabled(tx: Prisma.TransactionClient, organizationId: string, enabled: boolean, userId: string) {
    return tx.documentReaderPolicy.upsert({
      where: { organizationId },
      create: { organizationId, enabled, updatedBy: userId },
      update: { enabled, updatedBy: userId },
    });
  }

  db() {
    return this.tenancy.getClient();
  }

  file(organizationId: string, id: string) {
    return this.tenancy.getClient().platformFile.findFirst({
      where: { id, organizationId },
      select: { id: true, status: true, mimeType: true, sizeBytes: true },
    });
  }

  log(data: {
    organizationId: string; platformFileId: string; kind: DocumentReadingKind; provider: string; model: string;
    status: 'SUCCEEDED' | 'FAILED'; result?: Prisma.InputJsonValue; errorCode?: string; durationMs: number; createdBy: string;
  }) {
    return this.tenancy.getClient().documentReading.create({ data, select: { id: true } });
  }
}
