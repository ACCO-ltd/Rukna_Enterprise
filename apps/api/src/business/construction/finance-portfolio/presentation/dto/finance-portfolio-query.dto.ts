import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { FINANCE_PORTFOLIO_QUEUES, type FinancePortfolioQueue } from '@erp/types';

const PROJECT_STATUSES = ['DRAFT', 'ACTIVE', 'PRACTICAL_COMPLETION', 'CLOSEOUT', 'CLOSED', 'CANCELLED'] as const;

export class FinancePortfolioQueryDto {
  @ApiPropertyOptional({ enum: FINANCE_PORTFOLIO_QUEUES, description: 'A morning queue (ADR-043)' })
  @IsOptional()
  @IsIn(FINANCE_PORTFOLIO_QUEUES as unknown as string[])
  queue?: FinancePortfolioQueue;

  @ApiPropertyOptional({ description: 'Matches project code, name or client name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: PROJECT_STATUSES })
  @IsOptional()
  @IsIn(PROJECT_STATUSES as unknown as string[])
  status?: string;
}
