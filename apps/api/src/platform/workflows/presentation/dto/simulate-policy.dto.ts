import { IsDecimal, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { WorkflowTransactionType } from '@erp/types';

export class SimulatePolicyDto {
  @IsEnum(WorkflowTransactionType)
  transactionType!: WorkflowTransactionType;

  @IsOptional()
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  amount?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,79}$/)
  fromState?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,79}$/)
  toState?: string;
}
