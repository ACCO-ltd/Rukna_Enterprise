import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import type { SavedViewState } from '@erp/types';

// Shape only — the state's contents are checked in domain/saved-view-rules.ts.

export class ListSavedViewsQuery {
  @ApiProperty({ example: 'invoices' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,63}$/)
  listKey!: string;
}

export class CreateSavedViewDto {
  @ApiProperty({ example: 'invoices' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,63}$/)
  listKey!: string;

  @ApiProperty({ example: 'Overdue this month' })
  @IsString()
  @MaxLength(60)
  name!: string;

  @ApiProperty({ example: { filters: { status: 'APPROVED' }, sort: { key: 'dueDate', direction: 'asc' } } })
  @IsObject()
  state!: SavedViewState;
}

export class UpdateSavedViewDto {
  @ApiPropertyOptional({ example: 'Overdue — top clients' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  state?: SavedViewState;
}
