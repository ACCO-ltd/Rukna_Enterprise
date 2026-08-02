import { Module } from '@nestjs/common';
import { BoqController } from './presentation/boq.controller.js';
import { BoqVersioningService } from './application/boq-versioning.service.js';
import { BoqTreeService } from './application/boq-tree.service.js';
import { BoqPrismaRepository } from './infrastructure/boq-prisma.repository.js';

@Module({
  controllers: [BoqController],
  providers: [BoqVersioningService, BoqTreeService, BoqPrismaRepository],
  exports: [BoqVersioningService],
})
export class BoqModule {}
