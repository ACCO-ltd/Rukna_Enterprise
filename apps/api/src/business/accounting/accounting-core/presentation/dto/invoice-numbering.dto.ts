import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, MaxLength } from 'class-validator';

import { RESET_POLICIES, type NumberResetPolicy } from '../../domain/document-number-format.js';

// Shape only — the rules (prefix characters, digits, length, never below a number already issued)
// live in domain/document-number-format.ts and InvoiceNumberingService, which report every problem.
export class UpdateInvoiceNumberingDto {
  @ApiProperty({ example: 'INV-' })
  @IsString()
  @MaxLength(20)
  prefix!: string;

  @ApiProperty({ enum: RESET_POLICIES, example: 'YEARLY', description: 'NEVER = INV-000124; YEARLY = INV-2026-0001; MONTHLY = INV-2026-10-0001; DAILY = INV-2026-10-30-001' })
  @IsIn(RESET_POLICIES)
  resetPolicy!: NumberResetPolicy;

  @ApiProperty({ example: 4, description: '3 to 8' })
  @IsInt()
  paddingLength!: number;

  @ApiProperty({ example: 1, description: 'The count the next invoice dated today takes' })
  @IsInt()
  nextNumber!: number;
}
