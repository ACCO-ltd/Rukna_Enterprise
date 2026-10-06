import { Module } from '@nestjs/common';

import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AccountingCoreModule } from '../../accounting/accounting-core/accounting-core.module.js';
import { CommercialModule } from '../commercial/commercial.module.js';
import { FinancePortfolioModule } from '../finance-portfolio/finance-portfolio.module.js';
import { ProgrammeModule } from '../programme/programme.module.js';
import { ProgressModule } from '../progress/progress.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { DashboardService } from './application/dashboard.service.js';
import { DashboardController } from './presentation/dashboard.controller.js';

/**
 * `GET /dashboard` — a read-only composition of the modules that own each figure (finance
 * portfolio, commercial, projects, progress, programme, accounting guide). Construction →
 * accounting reads only (ARCH-BOUNDARY-001). ProjectAccessService comes from the global
 * ProjectAccessModule.
 */
@Module({
  imports: [
    TenancyModule,
    AccountingCoreModule,
    CommercialModule,
    FinancePortfolioModule,
    ProgrammeModule,
    ProgressModule,
    ProjectsModule,
  ],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
