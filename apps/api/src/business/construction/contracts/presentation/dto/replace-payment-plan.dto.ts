import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { PaymentInstallmentDto } from './create-contract.dto.js';

// ADR-023 / commercial-billing-model §5 P1: replace-all editor for a DRAFT MILESTONE contract's
// payment schedule. The body is the FULL installment list (same item shape as create's
// `paymentPlan`) — there is no granular add/edit/delete for the schedule. The service enforces
// DRAFT + MILESTONE + not-yet-invoiced + Σ(percentage) = 1 before writing.
export class ReplacePaymentPlanDto {
  @ApiProperty({
    type: [PaymentInstallmentDto],
    description:
      'The complete replacement payment schedule. Σ(percentage) must equal 1. The existing ' +
      'installments are removed and this set is written in their place (DRAFT contracts only).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PaymentInstallmentDto)
  installments!: PaymentInstallmentDto[];
}
