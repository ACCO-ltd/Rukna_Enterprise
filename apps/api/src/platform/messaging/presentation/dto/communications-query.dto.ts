import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Records whose messages `GET /communications` may list (all gated on manage:receivable). */
export const COMMUNICATION_RESOURCE_TYPES = ['client_invoice', 'client_invoice_reminder', 'payment_receipt'] as const;

export class CommunicationsQueryDto {
  @ApiProperty({ enum: COMMUNICATION_RESOURCE_TYPES, description: 'The kind of record the messages are about' })
  @IsIn(COMMUNICATION_RESOURCE_TYPES)
  resourceType!: (typeof COMMUNICATION_RESOURCE_TYPES)[number];

  @ApiProperty({ description: 'The record id' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  resourceId!: string;
}
