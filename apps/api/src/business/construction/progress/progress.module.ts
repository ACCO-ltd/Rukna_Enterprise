import { Module } from '@nestjs/common';

import { ProgressController } from './presentation/progress.controller.js';
import { ProgressService } from './application/progress.service.js';
import { ProgressRepository } from './infrastructure/progress.repository.js';

// TenancyModule and ProjectAccessModule are @Global.
@Module({
  controllers: [ProgressController],
  providers: [ProgressService, ProgressRepository],
  exports: [ProgressService],
})
export class ProgressModule {}
