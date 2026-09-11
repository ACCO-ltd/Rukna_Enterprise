import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDateString, IsOptional, MaxLength } from 'class-validator';

// ADR-029 CONST-BOQ-030/033 (R-4): generate a one-off client invoice for a SEPARATE_CHARGE BOQ leaf
// (an extra billed outside the milestone schedule). Feeds total client revenue, never contract value.
export class GenerateInvoiceFromSeparateChargeDto {
  @ApiProperty({ description: 'The SEPARATE_CHARGE BoqNode (leaf) ID to bill' })
  @IsString() @IsNotEmpty()
  boqNodeId!: string;

  @ApiProperty({ example: '2026-06-05' })
  @IsDateString()
  invoiceDate!: string;

  @ApiProperty({ example: '2026-07-05' })
  @IsDateString()
  dueDate!: string;

  @ApiPropertyOptional({ example: 'Net 30' })
  @IsString() @IsOptional() @MaxLength(100)
  paymentTerms?: string;
}
