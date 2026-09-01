import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export class PolicyReasonDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class SchedulePolicyDto extends PolicyReasonDto {
  @IsISO8601()
  effectiveFrom!: string;
}

export class ActivatePolicyDto extends PolicyReasonDto {
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;
}
