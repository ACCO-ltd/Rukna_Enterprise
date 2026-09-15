import { Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { NotificationsService } from '../application/notifications.service.js';
import { ListNotificationsQuery } from './dto/list-notifications.query.js';

/**
 * ADR-031 — the recipient's own notification center. Authentication only: owning your own
 * notifications is not a gated capability, so there is deliberately no `@RequirePermissions`. Every
 * route is scoped to `identity.userId` + `identity.activeOrganizationId` inside the service.
 */
@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "The caller's notifications, newest first (resolved rows excluded)." })
  @ApiResponse({ status: 200, description: 'NotificationListResponse' })
  list(@CurrentUser() identity: RequestIdentity, @Query() query: ListNotificationsQuery) {
    return this.notificationsService.list(identity.activeOrganizationId, identity.userId, {
      unread: query.unread === 'true',
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: "The caller's unread count — drives the bell badge." })
  @ApiResponse({ status: 200, description: 'UnreadCountResponse' })
  unreadCount(@CurrentUser() identity: RequestIdentity) {
    return this.notificationsService.unreadCount(identity.activeOrganizationId, identity.userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: "Mark one of the caller's own notifications read." })
  @ApiResponse({ status: 200, description: 'The updated NotificationItem' })
  @ApiResponse({ status: 404, description: 'Not the caller\'s own notification' })
  markRead(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.notificationsService.markRead(identity.activeOrganizationId, identity.userId, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: "Mark all of the caller's unread notifications read." })
  @ApiResponse({ status: 201, description: 'MarkAllReadResponse' })
  markAllRead(@CurrentUser() identity: RequestIdentity) {
    return this.notificationsService.markAllRead(identity.activeOrganizationId, identity.userId);
  }
}
