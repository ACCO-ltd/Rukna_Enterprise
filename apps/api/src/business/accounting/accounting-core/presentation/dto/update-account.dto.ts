import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsBoolean, IsOptional, MaxLength } from 'class-validator';

/**
 * Edit a GL account. Scoped to the SAFE fields only — a rename, a re-parent, or turning posting on/off.
 *
 * accountClass / accountSubtype / control-role are deliberately NOT editable here: reclassifying an
 * account that already has postings changes how prior-year P&L rolls up and is a domain decision, not
 * a UI toggle. The edit is applied as a NEW effective-dated AccountVersion (posted journals keep their
 * name snapshot), so history is preserved.
 */
export class UpdateAccountDto {
  @ApiPropertyOptional({ example: 'Accounts Receivable — Trade' })
  @IsString() @IsOptional() @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Whether new journals may post to this account.' })
  @IsBoolean() @IsOptional()
  isPostingAllowed?: boolean;

  @ApiPropertyOptional({ description: 'Parent account code, or empty string to detach.' })
  @IsString() @IsOptional() @MaxLength(30)
  parentAccountCode?: string;

  @ApiPropertyOptional({ example: 'Renamed to match the statutory chart' })
  @IsString() @IsOptional() @MaxLength(255)
  changeReason?: string;
}
