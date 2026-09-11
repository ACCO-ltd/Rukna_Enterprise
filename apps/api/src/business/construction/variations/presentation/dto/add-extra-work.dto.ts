import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsArray,
  ArrayNotEmpty,
  ValidateNested,
  MaxLength,
  Length,
  IsDecimal,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * The extra-work classifier — ADR-029 CONST-BOQ-029 / spec E-1..E-3.
 *
 * One post-commit scope line, priced as a lump sum (`amount`). Quantities/rates are decimal strings
 * (CONST-BOQ-014). The three treatments consume the line differently:
 *   - ABSORB   → an ABSORBED BOQ leaf funded from contingency (amount lands as a quantity-1 leaf).
 *   - SEPARATE → a SEPARATE_CHARGE BOQ leaf added in place (amount lands as a quantity-1 leaf).
 *   - VARIATION → a pre-priced DRAFT VariationOrder line (quantity 1 × amount).
 */
export class ExtraWorkLineDto {
  @ApiProperty({ example: 'Extra retaining wall' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @ApiProperty({ example: '2500.00', description: 'Lump-sum amount for this line. Decimal string, 2 dp.' })
  @IsDecimal({ decimal_digits: '0,2' })
  amount!: string;

  @ApiPropertyOptional({ example: 'm³' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({
    description: 'BOQ parent section for the ABSORB/SEPARATE leaf. Ignored for VARIATION.',
  })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({
    example: '01.500',
    maxLength: 50,
    description: 'Optional code override for the ABSORB/SEPARATE leaf. Ignored for VARIATION.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  code?: string;
}

export class AddExtraWorkDto {
  @ApiProperty({
    enum: ['ABSORB', 'VARIATION', 'SEPARATE'],
    description:
      'Who pays / how (CONST-BOQ-029). ABSORB = ACCO funds from contingency; VARIATION = client-paid, raises contract value (DRAFT VO); SEPARATE = client-paid one-off outside the contract.',
  })
  @IsIn(['ABSORB', 'VARIATION', 'SEPARATE'])
  treatment!: 'ABSORB' | 'VARIATION' | 'SEPARATE';

  @ApiProperty({ type: [ExtraWorkLineDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ExtraWorkLineDto)
  lines!: ExtraWorkLineDto[];

  @ApiPropertyOptional({
    description:
      'Required for VARIATION: the contract the new DRAFT VariationOrder attaches to. A project may have several contracts, so it is not inferable. Ignored for ABSORB/SEPARATE.',
  })
  @IsOptional()
  @IsString()
  contractId?: string;

  @ApiPropertyOptional({
    description: 'Optional title for the VARIATION VariationOrder. Ignored for ABSORB/SEPARATE.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  variationTitle?: string;
}
