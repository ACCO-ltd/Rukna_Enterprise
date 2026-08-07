import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { UomRepository } from './infrastructure/uom.repository.js';
import { MaterialCategoryRepository } from './infrastructure/material-category.repository.js';
import { SpendCategoryRepository } from './infrastructure/spend-category.repository.js';
import { MaterialRepository } from './infrastructure/material.repository.js';
import { UomService } from './application/uom.service.js';
import { MaterialCategoryService } from './application/material-category.service.js';
import { SpendCategoryService } from './application/spend-category.service.js';
import { MaterialService } from './application/material.service.js';
import { UomController } from './presentation/uom.controller.js';
import { MaterialCategoryController } from './presentation/material-category.controller.js';
import { SpendCategoryController } from './presentation/spend-category.controller.js';
import { MaterialController } from './presentation/material.controller.js';

@Module({
  imports: [TenancyModule],
  controllers: [UomController, MaterialCategoryController, SpendCategoryController, MaterialController],
  providers: [
    UomRepository,
    MaterialCategoryRepository,
    SpendCategoryRepository,
    MaterialRepository,
    UomService,
    MaterialCategoryService,
    SpendCategoryService,
    MaterialService,
  ],
  exports: [UomService, MaterialCategoryService, SpendCategoryService, MaterialService,
            UomRepository, MaterialCategoryRepository, SpendCategoryRepository, MaterialRepository],
})
export class CatalogueModule {}
