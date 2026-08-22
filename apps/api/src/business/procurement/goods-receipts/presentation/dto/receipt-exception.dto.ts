import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

// ADR-022 CONST-DOA-004 — request an exception for the PO creator to receive against their order.
export class RequestReceiptExceptionDto {
  @ApiProperty({ description: 'Purchase order the creator needs to receive against' })
  @IsString()
  @IsNotEmpty()
  purchaseOrderId!: string;

  @ApiProperty({ description: 'Why the PO creator must receive (e.g. staffing constraint)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class RejectReceiptExceptionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
