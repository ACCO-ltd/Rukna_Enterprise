import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

// ADR-022 CONST-DOA-005 — adds an authorized bank signatory.
export class AddSignatoryDto {
  @ApiProperty({ description: 'User to authorize as a signatory of this bank account' })
  @IsString()
  @IsNotEmpty()
  userId!: string;
}
