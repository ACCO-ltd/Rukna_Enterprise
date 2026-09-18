import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ResolveDisputeDto {
  @ApiPropertyOptional({ description: 'Optional resolution note' })
  @IsOptional()
  @IsString()
  resolutionNote?: string;
}
