import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CompanyTemplatesService } from '../application/company-templates.service.js';
import { UpdatePaymentPlanTemplateDto, UpdateScheduleTemplateDto } from './dto/company-templates.dto.js';

// Step 1b (ADR-047). Reads are open to anyone who can view projects (the contract and schedule
// builders start from these); saving or resetting is an organization setting (manage:organization).
@ApiTags('Company templates')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.projectsView)
@Controller('company-templates')
export class CompanyTemplatesController {
  constructor(private readonly service: CompanyTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'The payment plan and building schedule templates in force for this company' })
  get(@CurrentUser() identity: RequestIdentity) {
    return this.service.get(identity);
  }

  @Put('payment-plan')
  @RequirePermissions(PERMISSIONS.organizationsManage)
  @ApiOperation({ summary: "Save the company's payment plan template (stages must total 100%)" })
  @ApiResponse({ status: 400, description: 'TEMPLATE_INVALID — details.problems lists every rule broken' })
  savePaymentPlan(@CurrentUser() identity: RequestIdentity, @Body() dto: UpdatePaymentPlanTemplateDto) {
    return this.service.savePaymentPlan(identity, dto.rows);
  }

  @Delete('payment-plan')
  @RequirePermissions(PERMISSIONS.organizationsManage)
  @ApiOperation({ summary: 'Reset the payment plan template to the Rukna default' })
  resetPaymentPlan(@CurrentUser() identity: RequestIdentity) {
    return this.service.reset(identity, 'PAYMENT_PLAN');
  }

  @Put('schedule')
  @RequirePermissions(PERMISSIONS.organizationsManage)
  @ApiOperation({ summary: "Save the company's building schedule template" })
  @ApiResponse({ status: 400, description: 'TEMPLATE_INVALID — details.problems lists every rule broken' })
  saveSchedule(@CurrentUser() identity: RequestIdentity, @Body() dto: UpdateScheduleTemplateDto) {
    return this.service.saveSchedule(identity, dto.phases);
  }

  @Delete('schedule')
  @RequirePermissions(PERMISSIONS.organizationsManage)
  @ApiOperation({ summary: 'Reset the building schedule template to the Rukna default' })
  resetSchedule(@CurrentUser() identity: RequestIdentity) {
    return this.service.reset(identity, 'SCHEDULE');
  }
}
