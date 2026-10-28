import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { SetupImportAction, SetupImportRequest, SetupImportRow } from '@erp/types';

import { MAX_IMPORT_ROWS } from '../domain/import-rules.js';

const CELL_MAX = 1000;

/** One mapped spreadsheet row. Every cell is text; the import rules read it (import-rules.ts). */
export class SetupImportRowDto implements SetupImportRow {
  @IsOptional() @IsString() @MaxLength(CELL_MAX) name?: string;
  @IsOptional() @IsString() @MaxLength(CELL_MAX) code?: string;
  @IsOptional() @IsString() @MaxLength(CELL_MAX) taxNumber?: string;
  @IsOptional() @IsString() @MaxLength(CELL_MAX) contactName?: string;
  @IsOptional() @IsString() @MaxLength(CELL_MAX) phone?: string;
  @IsOptional() @IsString() @MaxLength(CELL_MAX) email?: string;
  @IsOptional() @IsString() @MaxLength(CELL_MAX) paymentTerms?: string;
  @IsOptional() @IsString() @MaxLength(CELL_MAX) currency?: string;
  @IsOptional() @IsString() @MaxLength(CELL_MAX) address?: string;
  @IsOptional() @IsString() @MaxLength(CELL_MAX) city?: string;
  @IsOptional() @IsString() @MaxLength(CELL_MAX) country?: string;
  @IsOptional() @IsString() @MaxLength(CELL_MAX) clientType?: string;
  @IsOptional() @IsString() @MaxLength(CELL_MAX) openingBalance?: string;

  @IsOptional() @IsIn(['CREATE', 'MERGE', 'SKIP']) action?: SetupImportAction;
  @IsOptional() @IsString() @MaxLength(64) mergeIntoId?: string;
}

export class SetupImportRequestDto implements SetupImportRequest {
  @IsArray()
  @ArrayMaxSize(MAX_IMPORT_ROWS)
  @ValidateNested({ each: true })
  @Type(() => SetupImportRowDto)
  rows!: SetupImportRowDto[];

  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: 'defaultCountry must be a two-letter country code' })
  defaultCountry!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'openingDate must be YYYY-MM-DD' })
  openingDate?: string;

  @IsOptional() @IsBoolean() skipRowsWithErrors?: boolean;
}
