import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class RecordSignedDateDto {
  @ApiProperty({ example: '2026-09-17', description: 'ISO date the parties physically signed the contract' })
  @IsDateString()
  signedDate!: string;
}
