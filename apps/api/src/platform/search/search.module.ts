import { Module } from '@nestjs/common';

import { SearchController } from './presentation/search.controller.js';
import { SearchService } from './application/search.service.js';
import { SearchRepository } from './infrastructure/search.repository.js';

// Step 2f (ADR-047). TenancyModule and ProjectAccessModule are @Global.
@Module({
  controllers: [SearchController],
  providers: [SearchService, SearchRepository],
})
export class SearchModule {}
