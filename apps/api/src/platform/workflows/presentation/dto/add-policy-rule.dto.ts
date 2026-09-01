import { IsDecimal, IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { WorkflowTransactionType } from '@erp/types';

export class AddPolicyRuleDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,79}$/)
  ruleKey!: string;

  @IsEnum(WorkflowTransactionType)
  transactionType!: WorkflowTransactionType;

  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,79}$/)
  requiredRole!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  minAmount?: string;

  @IsOptional()
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  maxAmount?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,79}$/)
  fromState?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,79}$/)
  toState?: string;
}
