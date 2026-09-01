import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
export class CreateRoleAccessReviewDto {
  @IsEnum(['CONFIRMED', 'CHANGES_REQUIRED']) decision!: 'CONFIRMED' | 'CHANGES_REQUIRED';
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
