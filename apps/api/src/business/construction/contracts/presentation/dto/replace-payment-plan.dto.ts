import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { PaymentInstallmentDto } from './create-contract.dto.js';

// ADR-023 / commercial-billing-model §5 P1 + Q-B: the payment-plan editor for a MILESTONE contract,
// permitted while DRAFT or ACTIVE. The body is the UN-INVOICED portion of the schedule (same item
// shape as create's `paymentPlan`) — there is no granular add/edit/delete. On DRAFT nothing is
// invoiced, so this is the whole plan (a full replace). On ACTIVE the already-invoiced installments
// are frozen and untouched; this set re-profiles only the remaining stages. The service enforces
// MILESTONE + (DRAFT|ACTIVE) + frozen-invoiced % + Σ(submitted %) = 1 before writing.
export class ReplacePaymentPlanDto {
  @ApiProperty({
    type: [PaymentInstallmentDto],
    description:
      'The un-invoiced portion of the payment schedule. On a DRAFT contract this is the whole plan; ' +
      'on an ACTIVE contract the already-invoiced installments stay frozen and this re-profiles the ' +
      'rest. Σ(already-invoiced %) + Σ(this set %) must equal 1.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PaymentInstallmentDto)
  installments!: PaymentInstallmentDto[];
}
