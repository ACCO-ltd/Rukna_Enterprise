import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { SearchService } from '../application/search.service.js';

/**
 * Step 2f (ADR-047) — the ⌘K record search. Authentication only at the route: each result group is
 * gated in the service on the permission its own list requires.
 */
@ApiTags('Search')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Find records by number, reference or name — only those the caller may open' })
  @ApiQuery({ name: 'q', required: true, description: 'At least 2 characters' })
  search(@CurrentUser() identity: RequestIdentity, @Query('q') q: string) {
    return this.service.search(identity, q);
  }
}
