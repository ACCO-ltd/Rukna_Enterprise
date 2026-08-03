import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, IsOptional, MaxLength } from 'class-validator';
import { GuaranteeStatus } from '@erp/types';

export class UpdateGuaranteeDto {
  @ApiPropertyOptional({ enum: GuaranteeStatus })
  @IsEnum(GuaranteeStatus)
  @IsOptional()
  status?: GuaranteeStatus;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;
}
