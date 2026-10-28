import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { SavedViewsService } from '../application/saved-views.service.js';
import { CreateSavedViewDto, ListSavedViewsQuery, UpdateSavedViewDto } from './dto/saved-view.dto.js';

/**
 * Step 2a (ADR-047) — saved list views. Authentication only: saving how you look at a list is not
 * a gated capability. Publishing to everyone needs manage:organization, checked in the service
 * because it depends on the view, not just the route.
 */
@ApiTags('Saved views')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('saved-views')
export class SavedViewsController {
  constructor(private readonly service: SavedViewsService) {}

  @Get()
  @ApiOperation({ summary: "The caller's views plus every published view on one list" })
  list(@CurrentUser() identity: RequestIdentity, @Query() query: ListSavedViewsQuery) {
    return this.service.list(identity, query.listKey);
  }

  @Post()
  @ApiOperation({ summary: 'Save the current list state as a personal view' })
  @ApiResponse({ status: 409, description: 'SAVED_VIEW_NAME_TAKEN | SAVED_VIEW_LIMIT' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateSavedViewDto) {
    return this.service.create(identity, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a view or replace its state (owner; admin for a published view)' })
  update(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: UpdateSavedViewDto) {
    return this.service.update(identity, id, dto);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Publish a view to everyone (manage:organization)' })
  publish(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.setPublished(identity, id, true);
  }

  @Post(':id/unpublish')
  @ApiOperation({ summary: 'Make a published view personal to its owner again (manage:organization)' })
  unpublish(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.setPublished(identity, id, false);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a view (owner; admin for a published view)' })
  async remove(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    await this.service.remove(identity, id);
  }
}
