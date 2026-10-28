import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import type { ImportBankStatementRequest, ImportStatementLine, PostStatementLineRequest } from '@erp/types';

/** Dates and amounts arrive as text and are checked by the service, which names the bad line. */
export class ImportStatementLineDto implements ImportStatementLine {
  @IsString() @MaxLength(10) transactionDate!: string;
  @IsString() @MaxLength(1000) description!: string;
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @IsString() @MaxLength(30) amount!: string;
}

export class ImportBankStatementDto implements ImportBankStatementRequest {
  @IsString() @MinLength(1) bankAccountId!: string;
  @IsString() @MaxLength(10) periodStart!: string;
  @IsString() @MaxLength(10) statementDate!: string;
  @IsString() @MaxLength(30) openingBalance!: string;
  @IsString() @MaxLength(30) closingBalance!: string;
  @IsOptional() @IsString() @MaxLength(255) fileName?: string;

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ImportStatementLineDto)
  lines!: ImportStatementLineDto[];
}

export class MatchStatementLineDto {
  @IsString() @MinLength(1) journalLineId!: string;
}

export class PostStatementLineDto implements PostStatementLineRequest {
  @IsString() @MinLength(1) accountId!: string;
  @IsOptional() @IsString() @MaxLength(500) memo?: string;
}
