import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsString, IsOptional, MaxLength } from 'class-validator';

export class ApproveManualJournalDto {
  @ApiProperty({ description: 'true = approve, false = reject' })
  @IsBoolean()
  approved!: boolean;

  @ApiPropertyOptional({ description: 'Required when approved = false' })
  @IsString() @IsOptional() @MaxLength(500)
  rejectionReason?: string;
}
