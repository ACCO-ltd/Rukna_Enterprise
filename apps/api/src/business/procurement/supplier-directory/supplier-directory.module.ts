import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { SupplierDirectoryRepository } from './infrastructure/supplier-directory.repository.js';
import { SupplierDirectoryService } from './application/supplier-directory.service.js';
import { SupplierDirectoryController } from './presentation/supplier-directory.controller.js';

@Module({
  imports: [TenancyModule],
  controllers: [SupplierDirectoryController],
  providers: [SupplierDirectoryRepository, SupplierDirectoryService],
})
export class SupplierDirectoryModule {}
