import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CommunicationsQueryDto {
  @ApiProperty({ example: 'client_invoice', description: "The record the messages are about, e.g. 'client_invoice' | 'payment_receipt'" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  resourceType!: string;

  @ApiProperty({ description: 'The record id' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  resourceId!: string;
}
