import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PostCreditNoteDto {
  @ApiPropertyOptional({ description: 'GL account code for AR (resolved by role if omitted)' })
  @IsOptional()
  @IsString()
  arAccountCode?: string;

  @ApiPropertyOptional({ description: 'GL account code for Revenue (resolved by role if omitted)' })
  @IsOptional()
  @IsString()
  revenueAccountCode?: string;

  @ApiPropertyOptional({ description: 'GL account code for VAT Output (resolved by role if omitted)' })
  @IsOptional()
  @IsString()
  vatAccountCode?: string;
}
