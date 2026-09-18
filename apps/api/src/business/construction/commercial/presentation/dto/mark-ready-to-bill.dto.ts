import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MarkReadyToBillDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
