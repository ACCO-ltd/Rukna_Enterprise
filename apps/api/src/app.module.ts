import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { RolesGuard } from './common/guards/roles.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';

import { DatabaseModule } from './platform/database/database.module.js';
import { TenancyModule } from './platform/tenancy/tenancy.module.js';
import { TenancyMiddleware } from './platform/tenancy/tenancy.middleware.js';
import { AuthModule } from './platform/auth/auth.module.js';
import { UsersModule } from './platform/users/users.module.js';
import { OrganizationsModule } from './platform/organizations/organizations.module.js';
import { RolesModule } from './platform/roles/roles.module.js';
import { PermissionsModule } from './platform/permissions/permissions.module.js';
import { AuditLogsModule } from './platform/audit-logs/audit-logs.module.js';
import { WorkflowsModule } from './platform/workflows/workflows.module.js';
import { ClientsModule } from './platform/clients/clients.module.js';
import { ConstructionModule } from './business/construction/construction.module.js';
import { FinanceModule } from './business/finance/finance.module.js';
import { AccountingModule } from './business/accounting/accounting.module.js';
import { ProcurementModule } from './business/procurement/procurement.module.js';
import { RetailModule } from './business/retail/retail.module.js';
import { ManufacturingModule } from './business/manufacturing/manufacturing.module.js';
import { ProjectAccessModule } from './platform/project-access/project-access.module.js';
import { AuditInterceptor } from './platform/audit-logs/application/audit.interceptor.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DatabaseModule,
    TenancyModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    RolesModule,
    PermissionsModule,
    AuditLogsModule,
    WorkflowsModule,
    ClientsModule,
    ProjectAccessModule,
    ConstructionModule,
    FinanceModule,
    AccountingModule,
    ProcurementModule,
    RetailModule,
    ManufacturingModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenancyMiddleware).forRoutes('*');
  }
}
