import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsNotEmpty, IsDateString,
  IsOptional, MaxLength, IsEnum,
} from 'class-validator';

export enum AdvanceReturnMethodDto {
  CASH = 'CASH',
  BANK = 'BANK',
  MOBILE_MONEY = 'MOBILE_MONEY',
}

export class CreateAdvanceReturnDto {
  @ApiProperty({ example: 500, description: 'Amount being returned' })
  // ADR-045: a number or a 2-dp string ("20.00"); validated (positive, ≤ 2 dp) by the service.
  @IsNotEmpty()
  amount!: number | string;

  @ApiProperty({ enum: AdvanceReturnMethodDto, description: 'Return method (CASH, BANK, or MOBILE_MONEY)' })
  @IsEnum(AdvanceReturnMethodDto)
  returnMethod!: AdvanceReturnMethodDto;

  @ApiPropertyOptional({ description: 'ADR-045: required for every method (cash lands in the cash box)' })
  @IsString() @IsOptional()
  destinationBankAccountId?: string;

  // receivedBy is intentionally absent from this DTO.
  // The Finance Officer who is authenticated and submits this request IS the person
  // recording the return. Setting receivedBy from the client would allow falsifying
  // who received the funds. It is set server-side from identity.userId in the controller.

  @ApiProperty({ example: '2025-04-15', description: 'ISO date the return was received' })
  @IsDateString()
  receivedAt!: string;

  @ApiPropertyOptional({ example: 'RET-2025-001', maxLength: 100 })
  @IsString() @IsOptional() @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsString() @IsOptional() @MaxLength(500)
  note?: string;
}
