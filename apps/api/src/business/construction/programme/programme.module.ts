import { Module } from '@nestjs/common';

import { ProgrammeController } from './presentation/programme.controller.js';
import { ProgrammeService } from './application/programme.service.js';
import { ProgrammeRepository } from './infrastructure/programme.repository.js';

// TenancyModule and ProjectAccessModule are @Global.
@Module({
  controllers: [ProgrammeController],
  providers: [ProgrammeService, ProgrammeRepository],
  exports: [ProgrammeService],
})
export class ProgrammeModule {}
