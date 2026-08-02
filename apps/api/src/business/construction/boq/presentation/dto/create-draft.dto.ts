import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDraftDto {
  @ApiPropertyOptional({ description: 'Optional notes for this draft version' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
