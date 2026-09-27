import { Module } from '@nestjs/common';

import { AuditLogsController } from './presentation/audit-logs.controller.js';
import { AuditLogsService } from './application/audit-logs.service.js';
import { AuditLogsPrismaRepository } from './infrastructure/audit-logs-prisma.repository.js';
import { AuditInterceptor } from './application/audit.interceptor.js';
import { TransactionalAuditOutboxService } from './application/transactional-audit-outbox.service.js';
import { AuditOutboxPublisherService } from './application/audit-outbox-publisher.service.js';
import { RecordActivityService } from './application/record-activity.service.js';

@Module({
  controllers: [AuditLogsController],
  providers: [
    AuditLogsService,
    AuditInterceptor,
    TransactionalAuditOutboxService,
    AuditOutboxPublisherService,
    RecordActivityService,
    { provide: 'IAuditLogsRepository', useClass: AuditLogsPrismaRepository },
  ],
  exports: [
    AuditLogsService,
    AuditInterceptor,
    TransactionalAuditOutboxService,
    AuditOutboxPublisherService,
    RecordActivityService,
  ],
})
export class AuditLogsModule {}
