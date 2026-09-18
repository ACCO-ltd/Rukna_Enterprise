import { IsString, IsISO8601, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { InvoiceDeliveryMethod } from '@erp/types';

const DELIVERY_METHODS: InvoiceDeliveryMethod[] = ['WHATSAPP', 'EMAIL', 'PHYSICAL', 'OTHER'];

export class RecordDeliveryDto {
  @ApiProperty({
    enum: DELIVERY_METHODS,
    description: 'How the invoice was sent to the client',
  })
  @IsIn(DELIVERY_METHODS)
  method!: InvoiceDeliveryMethod;

  @ApiProperty({ description: 'ISO 8601 datetime when the invoice was sent' })
  @IsISO8601()
  sentAt!: string;

  @ApiPropertyOptional({ description: 'Recipient identifier (phone, email, or contact name)' })
  @IsOptional()
  @IsString()
  recipient?: string;

  @ApiPropertyOptional({ description: 'Optional delivery note' })
  @IsOptional()
  @IsString()
  note?: string;
}
