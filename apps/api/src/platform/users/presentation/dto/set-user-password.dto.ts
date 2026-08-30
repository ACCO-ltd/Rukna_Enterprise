import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { SetUserPasswordRequest } from '@erp/types';

export class SetUserPasswordDto implements SetUserPasswordRequest {
  @ApiProperty({ description: 'Minimum 12 characters. Hashed with bcrypt cost 12.' })
  @IsString()
  @MinLength(12)
  password!: string;
}
