import { IsString, MinLength } from 'class-validator';

export class ChangeTemporaryPasswordDto {
  @IsString() @MinLength(12) password!: string;
}
