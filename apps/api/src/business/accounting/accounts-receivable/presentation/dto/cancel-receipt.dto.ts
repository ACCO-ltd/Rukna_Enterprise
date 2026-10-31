import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** RC-5 — why an unposted receipt is set aside. */
export class CancelReceiptDto {
  @ApiProperty({ example: 'Recorded twice' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}
