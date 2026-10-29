import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body of POST /payments/:paymentId/refunds (AP-5). Amount and date are checked by the service. */
export class RecordSupplierRefundDto {
  @ApiProperty({ description: 'The bank account the money came into' })
  @IsString()
  bankAccountId!: string;

  @ApiProperty({ example: '100.00', description: 'At most what the payment holds unapplied' })
  @IsString()
  amount!: string;

  @ApiProperty({ example: '2026-10-29' })
  @IsString()
  refundDate!: string;

  @ApiProperty({ description: 'Why the supplier paid this back: order cancelled, overpaid' })
  @IsString()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ description: "The supplier's transfer reference" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

export class ReverseSupplierRefundDto {
  @ApiProperty({ example: '2026-10-29' })
  @IsString()
  reversalDate!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}
