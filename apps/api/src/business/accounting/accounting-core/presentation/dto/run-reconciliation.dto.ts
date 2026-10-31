import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength } from 'class-validator';

/** GL-L — the control accounts are found from the chart; a code names one instead. */
export class RunReconciliationDto {
  @ApiPropertyOptional({ example: '11000' })
  @IsString() @IsOptional() @MaxLength(30)
  arAccountCode?: string;

  @ApiPropertyOptional({ example: '20000' })
  @IsString() @IsOptional() @MaxLength(30)
  apAccountCode?: string;
}
