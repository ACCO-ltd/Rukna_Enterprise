import { IsArray, IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class ProvisionTemporaryUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) @MaxLength(100) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(100) lastName!: string;
  @IsArray() @IsString({ each: true }) roleIds!: string[];
}
