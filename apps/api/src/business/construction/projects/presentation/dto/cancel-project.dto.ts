import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelProjectDto {
  @ApiProperty({ example: 'Client withdrew due to funding issues' })
  @IsString()
  @MaxLength(1000)
  reason!: string;
}
