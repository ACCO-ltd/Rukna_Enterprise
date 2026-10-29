import { Module } from '@nestjs/common';

import { SavedViewsController } from './presentation/saved-views.controller.js';
import { SavedViewsService } from './application/saved-views.service.js';
import { SavedViewsRepository } from './infrastructure/saved-views.repository.js';

// Step 2a (ADR-047). TenancyModule is @Global.
@Module({
  controllers: [SavedViewsController],
  providers: [SavedViewsService, SavedViewsRepository],
})
export class SavedViewsModule {}
