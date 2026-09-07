import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsInt,
  IsDateString,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import {
  DocumentCategory,
  DocumentDiscipline,
  DocumentRevisionPurpose,
  ProjectDocumentStatus,
} from '@prisma/client';

/**
 * Register a controlled document.
 *
 * Metadata is first-class and the file is one field among many, which is the opposite of the
 * upload-first flow this replaced: a controlled document is identified by its number and its
 * title, not by whatever the bytes happened to be called on someone's laptop.
 */
export class CreateProjectDocumentDto {
  @ApiProperty({ example: 'ACCO-OB-STR-DRG-0012', description: 'Unique within the project' })
  @IsString() @IsNotEmpty() @MaxLength(60)
  documentNumber!: string;

  @ApiProperty({ example: 'First Floor Slab Reinforcement' })
  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  @ApiProperty({ enum: DocumentCategory })
  @IsEnum(DocumentCategory)
  category!: DocumentCategory;

  @ApiPropertyOptional({ enum: DocumentDiscipline })
  @IsOptional() @IsEnum(DocumentDiscipline)
  discipline?: DocumentDiscipline;

  @ApiPropertyOptional({ description: 'Accountable for keeping the document current and valid' })
  @IsOptional() @IsString()
  responsibleUserId?: string;

  @ApiPropertyOptional({ example: 'Banadir Regional Administration' })
  @IsOptional() @IsString() @MaxLength(120)
  issuerName?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional() @IsDateString()
  issuedAt?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional() @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ example: '2027-08-31' })
  @IsOptional() @IsDateString()
  expiresAt?: string;

  @ApiProperty({ description: 'A confirmed (READY) PlatformFile id — becomes revision 1' })
  @IsString() @IsNotEmpty()
  platformFileId!: string;

  @ApiPropertyOptional({ example: 'R00', description: 'Business-facing label; drawings mostly' })
  @IsOptional() @IsString() @MaxLength(20)
  revisionCode?: string;

  @ApiPropertyOptional({ enum: DocumentRevisionPurpose, description: 'Drawings only' })
  @IsOptional() @IsEnum(DocumentRevisionPurpose)
  purpose?: DocumentRevisionPurpose;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional() @IsString() @MaxLength(300)
  notes?: string;
}

/**
 * Edit metadata.
 *
 * Every field is optional and `null` is a meaningful value — clearing an expiry date is a real
 * edit, so the service distinguishes "absent" from "explicitly null" rather than treating both as
 * "leave alone". Which fields this status admits is decided by `assertMetadataEditable`, not here.
 */
export class UpdateProjectDocumentDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(60)
  documentNumber?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ enum: DocumentCategory })
  @IsOptional() @IsEnum(DocumentCategory)
  category?: DocumentCategory;

  @ApiPropertyOptional({ enum: DocumentDiscipline, nullable: true })
  @IsOptional() @IsEnum(DocumentDiscipline)
  discipline?: DocumentDiscipline | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @IsString()
  responsibleUserId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @IsString() @MaxLength(120)
  issuerName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @IsDateString()
  issuedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @IsDateString()
  validFrom?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @IsDateString()
  expiresAt?: string | null;
}

/** Start a new revision of an issued document. The file is what makes it a revision. */
export class CreateDocumentRevisionDto {
  @ApiProperty({ description: 'A confirmed (READY) PlatformFile id' })
  @IsString() @IsNotEmpty()
  platformFileId!: string;

  @ApiPropertyOptional({ example: 'R02' })
  @IsOptional() @IsString() @MaxLength(20)
  revisionCode?: string;

  @ApiPropertyOptional({ enum: DocumentRevisionPurpose, description: 'Drawings only' })
  @IsOptional() @IsEnum(DocumentRevisionPurpose)
  purpose?: DocumentRevisionPurpose;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional() @IsString() @MaxLength(300)
  notes?: string;
}

/** Swap the file behind a DRAFT revision. Refused on anything issued. */
export class ReplaceRevisionFileDto {
  @ApiProperty({ description: 'A confirmed (READY) PlatformFile id' })
  @IsString() @IsNotEmpty()
  platformFileId!: string;
}

/** Issue the draft revision: it becomes current, its file freezes, the previous one supersedes. */
export class IssueRevisionDto {
  @ApiPropertyOptional({ example: '2026-09-04', description: 'Defaults to today' })
  @IsOptional() @IsDateString()
  issuedAt?: string;

  @ApiPropertyOptional({ example: 'R02' })
  @IsOptional() @IsString() @MaxLength(20)
  revisionCode?: string;

  @ApiPropertyOptional({ enum: DocumentRevisionPurpose, description: 'Drawings only' })
  @IsOptional() @IsEnum(DocumentRevisionPurpose)
  purpose?: DocumentRevisionPurpose;
}

export class WithdrawDocumentDto {
  @ApiProperty({ description: 'Why this document is no longer to be relied on' })
  @IsString() @IsNotEmpty() @MaxLength(300)
  reason!: string;
}

export class SupersedeDocumentDto {
  @ApiProperty({ description: 'The issued document in this project that replaces this one' })
  @IsString() @IsNotEmpty()
  supersededByDocumentId!: string;
}

/**
 * Register query.
 *
 * `validity` is a filter over a derived value, so it is translated into a date window server-side
 * rather than compared against a stored column — there is no stored column, deliberately.
 */
export class ListProjectDocumentsQueryDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: DocumentCategory })
  @IsOptional() @IsEnum(DocumentCategory)
  category?: DocumentCategory;

  @ApiPropertyOptional({ enum: DocumentDiscipline })
  @IsOptional() @IsEnum(DocumentDiscipline)
  discipline?: DocumentDiscipline;

  @ApiPropertyOptional({ enum: ProjectDocumentStatus })
  @IsOptional() @IsEnum(ProjectDocumentStatus)
  status?: ProjectDocumentStatus;

  @ApiPropertyOptional({ enum: ['NO_EXPIRY', 'NOT_YET_VALID', 'VALID', 'EXPIRING_SOON', 'EXPIRED'] })
  @IsOptional() @IsString()
  validity?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  responsibleUserId?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional() @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional() @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}

export class ListLinkedAttachmentsQueryDto {
  @ApiPropertyOptional({ enum: ['DAILY_PROGRESS_REPORT', 'CONTRACT', 'CONTRACT_GUARANTEE', 'IPA', 'IPC'] })
  @IsOptional() @IsString()
  sourceType?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional() @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional() @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}
