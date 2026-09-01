import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Creates a new, inactive policy version. Rules and publication are separate commands. */
export class CreatePolicyDraftDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,79}$/)
  policyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
