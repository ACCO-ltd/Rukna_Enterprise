import { IsString, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const DISPUTE_REASONS = [
  'OMISSION',
  'PRICE_ERROR',
  'WORK_NOT_ACCEPTED',
  'SCOPE_DISAGREEMENT',
  'OTHER',
] as const;

/**
 * Opening a dispute. Deliberately has NO outstandingAmount field — a dispute never
 * adjusts the AR balance. Enforced structurally here.
 */
export class OpenDisputeDto {
  @ApiPropertyOptional({ description: 'Optional disputed portion (decimal string)' })
  @IsOptional()
  @IsString()
  disputedAmount?: string;

  @ApiProperty({ enum: DISPUTE_REASONS, description: 'Why the client is disputing' })
  @IsIn(DISPUTE_REASONS)
  reason!: 'OMISSION' | 'PRICE_ERROR' | 'WORK_NOT_ACCEPTED' | 'SCOPE_DISAGREEMENT' | 'OTHER';

  @ApiPropertyOptional({ description: 'Optional note' })
  @IsOptional()
  @IsString()
  note?: string;
}
