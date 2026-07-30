import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

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
import { ConstructionModule } from './business/construction/construction.module.js';
import { RetailModule } from './business/retail/retail.module.js';
import { ManufacturingModule } from './business/manufacturing/manufacturing.module.js';

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
    ConstructionModule,
    RetailModule,
    ManufacturingModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenancyMiddleware).forRoutes('*');
  }
}
