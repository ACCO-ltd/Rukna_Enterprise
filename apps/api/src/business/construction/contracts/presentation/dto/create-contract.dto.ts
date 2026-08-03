import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsDecimal,
  IsEnum,
  IsOptional,
  IsDateString,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';
import { BillingModel } from '@erp/types';

export class CreateContractDto {
  @ApiProperty({ description: 'Project ID this contract belongs to' })
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @ApiProperty({ description: 'Client ID' })
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @ApiProperty({ description: 'BOQ Version ID (baselined) to attach to this contract' })
  @IsString()
  @IsNotEmpty()
  boqVersionId!: string;

  @ApiProperty({ example: 'ACCO-2026-001' })
  @IsString()
  @MaxLength(50)
  contractNumber!: string;

  @ApiProperty({ example: '5000000.00' })
  @IsDecimal()
  contractValue!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @MaxLength(3)
  currency!: string;

  @ApiPropertyOptional({ enum: BillingModel, default: BillingModel.MEASURED_IPC })
  @IsEnum(BillingModel)
  @IsOptional()
  billingModel?: BillingModel;

  @ApiPropertyOptional({ example: '2026-01-15' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2027-12-31' })
  @IsDateString()
  @IsOptional()
  expectedEndDate?: string;
}
