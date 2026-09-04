import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { BoqImportMode } from '@erp/types';

/**
 * Structural validation only. Every *business* rule — code shape, hierarchy, pricing, duplicates,
 * depth, the row cap — lives in `boq-import.policy.ts` so it produces per-row findings the preview
 * can render (Q6). This layer just keeps obviously malformed JSON out of the service.
 *
 * `quantity` / `unitRate` / `sheetAmount` stay decimal **strings** (CONST-BOQ-014); the planner
 * parses and range-checks them. `unit` is capped at the node column width; `description` mirrors
 * the single-node create.
 */
export class ImportRowDto {
  @ApiProperty({ description: '1-based line in the source sheet, echoed back in findings.' })
  @IsInt()
  @Min(1)
  rowNumber!: number;

  @ApiProperty({ example: '02.01.003' })
  @IsString()
  code!: string;

  @ApiProperty({ example: 'Reinforced concrete columns' })
  @IsString()
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ example: 'm³' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ example: '120.500', description: 'Decimal string' })
  @IsOptional()
  @IsString()
  quantity?: string;

  @ApiPropertyOptional({ example: '250.00', description: 'Decimal string' })
  @IsOptional()
  @IsString()
  unitRate?: string;

  @ApiPropertyOptional({ example: '30000.00', description: "The sheet's own total, advisory only." })
  @IsOptional()
  @IsString()
  sheetAmount?: string;
}

export class ImportBoqDto {
  @ApiProperty({ enum: ['REPLACE', 'APPEND'], description: 'How the import lands against an existing draft.' })
  @IsIn(['REPLACE', 'APPEND'])
  mode!: BoqImportMode;

  @ApiProperty({ description: 'Also add each imported leaf to the item library (Q7).' })
  @IsBoolean()
  addToLibrary!: boolean;

  @ApiProperty({ type: [ImportRowDto] })
  @IsArray()
  // A hard DoS ceiling only — the planner enforces the real per-import limit and returns the
  // TOO_MANY_ROWS finding with the exact count.
  @ArrayMaxSize(20000)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];
}
