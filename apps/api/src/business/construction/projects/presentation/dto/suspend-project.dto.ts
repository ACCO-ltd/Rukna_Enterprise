import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SuspendProjectDto {
  @ApiProperty({ example: 'Awaiting site access clearance from municipality' })
  @IsString()
  @MaxLength(1000)
  reason!: string;
}
