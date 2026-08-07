import {
  Controller, Get, Post, Body, Param,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { BillMatchingService } from '../application/bill-matching.service.js';

class ApproveExceptionDto {
  @ApiProperty()
  @IsString()
  approvalReason: string;
}

@ApiTags('Procurement — Bill Matching')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('procurement/bill-matching')
export class BillMatchingController {
  constructor(private readonly service: BillMatchingService) {}

  @Get(':billId')
  @ApiParam({ name: 'billId' })
  @ApiOperation({ summary: 'Get matching result for a supplier bill' })
  findByBillId(@CurrentUser() identity: RequestIdentity, @Param('billId') billId: string) {
    return this.service.findByBillId(identity, billId);
  }

  @Post(':billId/run')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'billId' })
  @ApiOperation({ summary: 'Run two-way or three-way matching for a supplier bill' })
  runMatching(@CurrentUser() identity: RequestIdentity, @Param('billId') billId: string) {
    return this.service.runMatching(identity, billId);
  }

  @Post(':billId/approve-exception')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'billId' })
  @ApiOperation({ summary: 'Approve a matching exception: EXCEPTION → APPROVED_EXCEPTION' })
  approveException(
    @CurrentUser() identity: RequestIdentity,
    @Param('billId') billId: string,
    @Body() dto: ApproveExceptionDto,
  ) {
    return this.service.approveException(identity, billId, dto);
  }
}
