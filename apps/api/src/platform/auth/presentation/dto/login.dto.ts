import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@company.rukna.app', description: 'User email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', description: 'Minimum 8 characters', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}
