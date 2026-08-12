import { Module } from '@nestjs/common';

import { AuditLogsController } from './presentation/audit-logs.controller.js';
import { AuditLogsService } from './application/audit-logs.service.js';
import { AuditLogsPrismaRepository } from './infrastructure/audit-logs-prisma.repository.js';
import { AuditInterceptor } from './application/audit.interceptor.js';

@Module({
  controllers: [AuditLogsController],
  providers: [
    AuditLogsService,
    AuditInterceptor,
    { provide: 'IAuditLogsRepository', useClass: AuditLogsPrismaRepository },
  ],
  exports: [AuditLogsService, AuditInterceptor],
})
export class AuditLogsModule {}
