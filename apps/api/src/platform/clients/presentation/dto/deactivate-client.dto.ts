import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeactivateClientDto {
  @ApiProperty({
    minLength: 3,
    maxLength: 500,
    description: 'Why the client is being deactivated (3–500 characters, trimmed).',
  })
  @IsString()
  reason!: string;
}
