import {
  Controller, Get, Post, Body, Param,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MatchExceptionReason } from '@prisma/client';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';
import { BillMatchingService } from '../application/bill-matching.service.js';

class ApproveExceptionDto {
  @ApiProperty()
  @IsString()
  approvalReason: string;
}

class ResolveExceptionDto {
  // ADR-018 CONST-MATCH-007 — a defined reason, never free text. The reason fixes the path.
  @ApiProperty({ enum: MatchExceptionReason })
  @IsEnum(MatchExceptionReason)
  reason: MatchExceptionReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

@ApiTags('Procurement — Bill Matching')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.procurementView)
@Controller('procurement/bill-matching')
export class BillMatchingController {
  constructor(private readonly service: BillMatchingService) {}

  @Get(':billId')
  @ApiParam({ name: 'billId' })
  @ApiOperation({ summary: 'Get matching result for a supplier bill' })
  findByBillId(@CurrentUser() identity: RequestIdentity, @Param('billId') billId: string) {
    return this.service.findByBillId(identity, billId);
  }

  // D6 — matching is auto-run on bill submit (SupplierBillService.submit), so this is NOT a routine
  // step. It is retained (not deprecated) for the re-match after an exception is resolved by a PO
  // revision or a receipt correction (ADR-018 CONST-MATCH-010/011: recommit + rematch clears the
  // EXCEPTION). It is idempotent — re-running a clean bill produces the same verdict.
  @Post(':billId/run')
  @RequirePermissions(PERMISSIONS.payablesManage)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'billId' })
  @ApiOperation({
    summary:
      'Re-run matching for a supplier bill. Not required in the normal flow (matching auto-runs on ' +
      'submit); used to re-match after a PO revision or receipt correction clears an exception.',
  })
  runMatching(@CurrentUser() identity: RequestIdentity, @Param('billId') billId: string) {
    return this.service.runMatching(identity, billId);
  }

  @Post(':billId/approve-exception')
  @RequirePermissions(PERMISSIONS.matchingExceptionsApprove)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'billId' })
  @ApiOperation({ summary: 'Approve a matching exception: EXCEPTION → APPROVED_EXCEPTION (free-text; legacy)' })
  approveException(
    @CurrentUser() identity: RequestIdentity,
    @Param('billId') billId: string,
    @Body() dto: ApproveExceptionDto,
  ) {
    return this.service.approveException(identity, billId, dto);
  }

  @Post(':billId/resolve')
  @RequirePermissions(PERMISSIONS.matchingExceptionsApprove)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'billId' })
  @ApiOperation({
    summary: 'Resolve a matching exception by structured reason (ADR-018 CONST-MATCH-007/008). ' +
      'APPROVE reasons → APPROVED_EXCEPTION; SUPPLIER_INVOICE_ERROR → DISPUTED (never posts); ' +
      'PO-revision / receipt-correction reasons keep it an EXCEPTION until corrected + rematched.',
  })
  resolveException(
    @CurrentUser() identity: RequestIdentity,
    @Param('billId') billId: string,
    @Body() dto: ResolveExceptionDto,
  ) {
    return this.service.resolveException(identity, billId, dto);
  }
}
