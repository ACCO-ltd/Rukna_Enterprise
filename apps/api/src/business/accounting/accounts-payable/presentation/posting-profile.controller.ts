import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';

@ApiTags('Posting Profiles')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('posting-profiles')
export class PostingProfileController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get()
  @ApiOperation({ summary: 'List posting profiles for the organization' })
  @ApiQuery({ name: 'status', enum: ['ACTIVE', 'INACTIVE'], required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('status') status?: 'ACTIVE' | 'INACTIVE',
  ) {
    const prisma = this.tenancy.getClient();
    return prisma.postingProfile.findMany({
      where: { organizationId: identity.activeOrganizationId, ...(status ? { status } : {}) },
      include: { versions: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
      orderBy: { code: 'asc' },
    });
  }
}
