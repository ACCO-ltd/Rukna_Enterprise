import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsDecimal,
  IsEnum,
  Min,
  MaxLength,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MeasurementMethod, PricingBasis } from '@erp/types';

/**
 * Quantities and rates are decimal **strings**, not numbers — CONST-BOQ-014, and the same
 * convention `AddIpaItemDto` / `AddIpaDeductionDto` already use. A JSON number cannot
 * represent `0.1` exactly, and a BOQ rate is multiplied by a quantity and summed 400 times.
 *
 * `decimal_digits: '0,n'` keeps the decimal point optional, so `"680"` and `"680.500"` are
 * both accepted while `"680.5001"` is not. The authoritative scale check is in
 * `boq-node.policy.ts` — this one only keeps obviously malformed input out of the service.
 */
export class CreateNodeDto {
  @ApiPropertyOptional({ description: 'Parent node ID — omit for root-level nodes' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({
    description:
      'Sort order among siblings. Omit to append. Positions are dense and unique per parent (CONST-BOQ-017).',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({ example: '1.2.3', maxLength: 50, description: 'Unique within the version' })
  @IsString()
  @Length(1, 50)
  code!: string;

  @ApiProperty({ example: 'Reinforced concrete columns' })
  @IsString()
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  descriptionAr?: string;

  @ApiPropertyOptional({
    description: 'True = billable item (carries quantity/rate). False = section.',
  })
  @IsOptional()
  @IsBoolean()
  isLeaf?: boolean;

  @ApiPropertyOptional({ example: 'm³' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ example: '120.500', description: 'Decimal string, up to 3 dp' })
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,3' })
  quantity?: string;

  @ApiPropertyOptional({ example: '250.00', description: 'Decimal string, up to 2 dp' })
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,2' })
  unitRate?: string;

  @ApiPropertyOptional({
    example: 'USD',
    maxLength: 3,
    description:
      'Optional. Must equal the BOQ currency when supplied — a BOQ holds one currency (CONST-BOQ-013).',
  })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({
    enum: MeasurementMethod,
    description: 'How the item is measured for payment. Leaf items only (CONST-BOQ-012).',
  })
  @IsOptional()
  @IsEnum(MeasurementMethod)
  measurementMethod?: MeasurementMethod;

  @ApiPropertyOptional({
    enum: PricingBasis,
    description: 'How the item is priced. A pricing basis, not a measurement method.',
  })
  @IsOptional()
  @IsEnum(PricingBasis)
  pricingBasis?: PricingBasis;
}
