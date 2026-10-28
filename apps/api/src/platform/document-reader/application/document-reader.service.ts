import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  PERMISSIONS,
  type DocumentReadResult,
  type DocumentReaderStatus,
  type DocumentReadingKind,
  type PermissionKey,
  type RequestIdentity,
} from '@erp/types';

import { TransactionalAuditOutboxService } from '../../audit-logs/application/transactional-audit-outbox.service.js';
import { FileAuthorizationService } from '../../files/application/file-authorization.service.js';
import { PlatformFileService } from '../../files/application/platform-file.service.js';
import { parseReaderAnswer, readerPrompt, UnreadableAnswerError } from '../domain/reading.js';
import { DocumentReaderRepository } from '../infrastructure/document-reader.repository.js';
import { DOCUMENT_READER_PROVIDER, ReaderProviderError, type DocumentReaderProvider } from './reader-provider.port.js';

/** Who may read which kind of photo: whoever fills the form the reading pre-fills. */
const READ_PERMISSION: Record<DocumentReadingKind, PermissionKey> = {
  DELIVERY_NOTE: PERMISSIONS.goodsReceiptsCreate,
  MATERIAL_LIST: PERMISSIONS.materialRequestsCreate,
  // Money is read on the finance side only: the buyer photographs, finance records (ADR-044/045).
  RECEIPT: PERMISSIONS.payablesManage,
  QUOTE: PERMISSIONS.quotationsAward,
};

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Step 7 — the photo reader. Reads a photo the caller may already see and returns what it found,
 * to pre-fill a form; it never writes to any document — a person confirms every field and saves.
 *
 * Owner decisions (2026-10-28): a cloud reader (OpenRouter free models) is allowed, but each
 * company's reader is off until an administrator turns it on, with a note saying where photos go;
 * every reading is logged (`document_readings`), success or not.
 */
@Injectable()
export class DocumentReaderService {
  constructor(
    @Inject(DOCUMENT_READER_PROVIDER) private readonly provider: DocumentReaderProvider,
    private readonly repo: DocumentReaderRepository,
    private readonly files: PlatformFileService,
    private readonly fileAuth: FileAuthorizationService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  async status(identity: RequestIdentity): Promise<DocumentReaderStatus> {
    const available = this.provider.isAvailable();
    return {
      available,
      enabled: available && (await this.repo.enabled(identity.activeOrganizationId)),
      provider: this.provider.label,
      model: this.provider.model(),
    };
  }

  async setEnabled(identity: RequestIdentity, enabled: boolean): Promise<DocumentReaderStatus> {
    if (enabled && !this.provider.isAvailable()) {
      throw new BadRequestException({ errorCode: 'READER_NOT_CONFIGURED', message: 'No photo reader is configured on this server.' });
    }
    await this.repo.db().$transaction(async (tx) => {
      await this.repo.setEnabled(tx, identity.activeOrganizationId, enabled, identity.userId);
      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'DocumentReaderPolicy',
        resourceId: identity.activeOrganizationId,
        sourceCommand: 'document-reader.set-enabled',
        eventType: enabled ? 'DOCUMENT_READER_ENABLED' : 'DOCUMENT_READER_DISABLED',
        idempotencyKey: `document-reader-${identity.activeOrganizationId}-${Date.now()}`,
        after: { enabled, provider: this.provider.label, model: this.provider.model() },
      });
    });
    return this.status(identity);
  }

  async read(identity: RequestIdentity, platformFileId: string, kind: DocumentReadingKind): Promise<DocumentReadResult> {
    const orgId = identity.activeOrganizationId;
    const has = (p: string) => identity.permissions.includes('*') || identity.permissions.includes(p);
    if (!has(READ_PERMISSION[kind])) {
      throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'You do not fill in this kind of document.' });
    }
    if (!this.provider.isAvailable()) {
      throw new BadRequestException({ errorCode: 'READER_NOT_CONFIGURED', message: 'No photo reader is configured on this server.' });
    }
    if (!(await this.repo.enabled(orgId))) {
      throw new ForbiddenException({ errorCode: 'READER_DISABLED', message: 'The photo reader is turned off for this company. An administrator can turn it on in Administration.' });
    }

    const file = await this.repo.file(orgId, platformFileId);
    if (!file) throw new NotFoundException({ errorCode: 'FILE_NOT_FOUND', message: 'File not found' });
    if (file.status !== 'READY') throw new BadRequestException({ errorCode: 'FILE_NOT_READY', message: 'The photo has not finished uploading.' });
    if (!IMAGE_TYPES.has(file.mimeType)) throw new BadRequestException({ errorCode: 'NOT_AN_IMAGE', message: 'The reader reads photos (JPEG, PNG or WebP).' });
    if (file.sizeBytes > MAX_BYTES) throw new BadRequestException({ errorCode: 'IMAGE_TOO_LARGE', message: 'The photo is too large to read.' });
    // The reader only ever sees a photo the caller may see.
    await this.fileAuth.assertCanRead(identity, platformFileId);

    const bytes = await this.files.readBytesForRendering(platformFileId);
    if (!bytes) throw new BadRequestException({ errorCode: 'FILE_NOT_READY', message: 'The photo could not be read from storage.' });

    const started = Date.now();
    const base = { organizationId: orgId, platformFileId, kind, provider: this.provider.label ?? 'none', model: this.provider.model() ?? 'none', createdBy: identity.userId };
    let answer: string;
    try {
      answer = await this.provider.read({ bytes: bytes.buffer, mimeType: bytes.mimeType }, readerPrompt(kind));
    } catch (error) {
      const code = error instanceof ReaderProviderError ? error.code : 'PROVIDER_ERROR';
      await this.repo.log({ ...base, status: 'FAILED', errorCode: code, durationMs: Date.now() - started });
      const status = code === 'RATE_LIMITED' ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.BAD_GATEWAY;
      throw new HttpException({ errorCode: `READER_${code}`, message: error instanceof Error ? error.message : 'The photo reader failed.' }, status);
    }

    let parsed;
    try {
      parsed = parseReaderAnswer(answer);
    } catch (error) {
      if (!(error instanceof UnreadableAnswerError)) throw error;
      await this.repo.log({ ...base, status: 'FAILED', errorCode: 'UNREADABLE_ANSWER', durationMs: Date.now() - started });
      throw new HttpException({ errorCode: 'READER_UNREADABLE', message: 'The reader could not make sense of this photo. Fill the form in by hand, or retake the photo.' }, HttpStatus.BAD_GATEWAY);
    }
    const logged = await this.repo.log({ ...base, status: 'SUCCEEDED', result: parsed as never, durationMs: Date.now() - started });
    return { readingId: logged.id, kind, ...parsed };
  }
}
