import { IsArray, IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { CreateUserRequest } from '@erp/types';

export class CreateUserDto implements CreateUserRequest {
  @ApiProperty({ example: 'jane.doe@acco.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ description: 'Minimum 12 characters. Hashed with bcrypt cost 12.' })
  @IsString()
  @MinLength(12)
  password!: string;

  @ApiProperty({ type: [String], description: 'Role ids to assign on the default membership.' })
  @IsArray()
  @IsString({ each: true })
  roleIds!: string[];
}
