import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsArray, IsOptional, MaxLength } from 'class-validator';

export class RunReconciliationDto {
  @ApiProperty({ example: 'AR-001' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  arAccountCode!: string;

  @ApiProperty({ example: 'AP-001' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  apAccountCode!: string;

  @ApiPropertyOptional({ type: [String], example: ['BNK-001'] })
  @IsArray() @IsOptional()
  bankAccountCodes?: string[];

  @ApiPropertyOptional({ description: 'Scope reconciliation to a specific accounting period' })
  @IsString() @IsOptional()
  periodId?: string;
}
