import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsNotEmpty, IsNumber, Min, IsDateString,
  IsOptional, MaxLength, IsEnum,
} from 'class-validator';

export enum AdvanceReturnMethodDto {
  CASH = 'CASH',
  BANK = 'BANK',
  MOBILE_MONEY = 'MOBILE_MONEY',
}

export class CreateAdvanceReturnDto {
  @ApiProperty({ example: 500, description: 'Amount being returned' })
  @IsNumber() @Min(0.01)
  amount!: number;

  @ApiProperty({ enum: AdvanceReturnMethodDto, description: 'Return method (CASH, BANK, or MOBILE_MONEY)' })
  @IsEnum(AdvanceReturnMethodDto)
  returnMethod!: AdvanceReturnMethodDto;

  @ApiPropertyOptional({ description: 'Required when returnMethod is BANK or MOBILE_MONEY' })
  @IsString() @IsOptional()
  destinationBankAccountId?: string;

  @ApiProperty({ description: 'User ID of the Finance officer who received the return' })
  @IsString() @IsNotEmpty()
  receivedBy!: string;

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
