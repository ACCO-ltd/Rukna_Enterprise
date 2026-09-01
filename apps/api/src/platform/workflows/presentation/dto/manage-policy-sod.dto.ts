import { IsBoolean, IsString, Matches } from 'class-validator';

export class ManagePolicySodDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,79}$/)
  code!: string;

  @IsString()
  description!: string;

  @IsBoolean()
  isActive!: boolean;
}
