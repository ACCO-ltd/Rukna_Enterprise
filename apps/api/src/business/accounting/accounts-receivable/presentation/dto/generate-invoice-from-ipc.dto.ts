import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDateString, IsOptional, MaxLength } from 'class-validator';

export class GenerateInvoiceFromIpcDto {
  @ApiProperty({ description: 'Effective InterimPaymentCertificate ID' })
  @IsString() @IsNotEmpty()
  ipcId!: string;

  @ApiProperty({ example: '2025-01-15' })
  @IsDateString()
  invoiceDate!: string;

  @ApiProperty({ example: '2025-02-14' })
  @IsDateString()
  dueDate!: string;

  @ApiPropertyOptional({ example: 'Net 30' })
  @IsString() @IsOptional() @MaxLength(100)
  paymentTerms?: string;
}
