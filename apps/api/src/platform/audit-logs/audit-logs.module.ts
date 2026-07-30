import { Module } from '@nestjs/common';

import { AuditLogsController } from './presentation/audit-logs.controller.js';
import { AuditLogsService } from './application/audit-logs.service.js';
import { AuditLogsPrismaRepository } from './infrastructure/audit-logs-prisma.repository.js';

@Module({
  controllers: [AuditLogsController],
  providers: [
    AuditLogsService,
    { provide: 'IAuditLogsRepository', useClass: AuditLogsPrismaRepository },
  ],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
