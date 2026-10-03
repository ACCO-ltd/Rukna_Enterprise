import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { WhatsAppSendRequest } from '@erp/types';

/** `POST /customer-receipts/:id/whatsapp` — the shared WhatsApp send shape (`WhatsAppSendRequest`). */
export class SendReceiptWhatsAppDto implements WhatsAppSendRequest {
  @ApiPropertyOptional({
    example: '+252612345678',
    description: "E.164. Omitted → the preview's defaultRecipient (the primary contact's number).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  recipient?: string;

  @ApiProperty({
    example: '3f1c2a9e-6d4b-4f0a-9b1e-2c7d5e8f9a01',
    description: 'One per intended send (e.g. a UUID made when the dialog opens); reuse it to retry the same send.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey!: string;
}
