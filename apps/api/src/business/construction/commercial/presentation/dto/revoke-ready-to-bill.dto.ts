import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RevokeReadyToBillDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
