import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsDecimal,
  IsOptional,
  IsArray,
  ValidateNested,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IpcStatus } from '@erp/types';

export class IpcItemDto {
  @ApiProperty({ description: 'Application item ID being certified' })
  @IsString()
  @IsNotEmpty()
  applicationItemId!: string;

  @ApiProperty()
  @IsDecimal()
  certifiedQuantity!: string;

  @ApiPropertyOptional({ description: 'Required when certifiedQuantity ≠ claimedQuantity' })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  varianceReason?: string;
}

export class IpcDeductionDto {
  @ApiProperty({ description: 'Ad-hoc deduction type (e.g. TAX, CONTRA). RETENTION and ADVANCE_RECOVERY are derived automatically from contract terms.' })
  @IsString()
  @MaxLength(100)
  deductionType!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sourceTermId?: string;

  @ApiPropertyOptional()
  @IsDecimal()
  @IsOptional()
  rate?: string;

  @ApiProperty()
  @IsDecimal()
  basis!: string;

  @ApiProperty()
  @IsDecimal()
  amount!: string;
}

export class CreateIpcDto {
  @ApiProperty({ description: 'IPA ID this certificate responds to' })
  @IsString()
  @IsNotEmpty()
  applicationId!: string;

  @ApiProperty({ enum: IpcStatus })
  @IsEnum(IpcStatus)
  status!: IpcStatus;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @MaxLength(3)
  currency!: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ type: [IpcItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IpcItemDto)
  @IsOptional()
  items?: IpcItemDto[];

  @ApiPropertyOptional({ type: [IpcDeductionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IpcDeductionDto)
  @IsOptional()
  deductions?: IpcDeductionDto[];
}
