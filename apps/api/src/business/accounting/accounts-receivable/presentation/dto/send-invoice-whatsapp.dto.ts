import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** `POST /invoices/:id/whatsapp` (ADR-042 WhatsApp V1 step 2). */
export class SendInvoiceWhatsAppDto {
  @ApiPropertyOptional({
    example: '+252612345678',
    description: "E.164; omitted → the client's primary contact number",
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  recipient?: string;

  @ApiProperty({
    description:
      'Client-generated uuid, one per intended message — a repeat returns the same message',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey!: string;
}
