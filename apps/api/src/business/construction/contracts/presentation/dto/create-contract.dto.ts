import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsDecimal,
  IsEnum,
  IsOptional,
  IsDateString,
  MaxLength,
  IsNotEmpty,
  IsArray,
  IsInt,
  IsNumber,
  Min,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BillingModel } from '@erp/types';
import { ContractKind, PaymentTrigger } from '@prisma/client';

// ADR-023: one installment of a negotiated payment schedule (MILESTONE billing model).
// `percentage` is a fraction (0..1), e.g. 0.40 for a 40% advance. The service enforces
// Σ(percentage) = 1 across the plan. Amount is derived (percentage × contract value), never sent.
export class PaymentInstallmentDto {
  @ApiProperty({ example: 0, description: 'Display order' })
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @ApiProperty({ example: 'Advance payment' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 0.4, description: 'Fraction of contract value (0..1)' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  percentage!: number;

  @ApiProperty({ enum: PaymentTrigger })
  @IsEnum(PaymentTrigger)
  triggerType!: PaymentTrigger;

  @ApiPropertyOptional({ example: 90, description: 'TIME_BASED: days after commencement' })
  @IsInt()
  @Min(0)
  @IsOptional()
  dueOffsetDays?: number;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'TIME_BASED: explicit due date' })
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @ApiPropertyOptional({ example: 'Structure complete', description: 'MILESTONE: stage label' })
  @IsString()
  @MaxLength(120)
  @IsOptional()
  milestoneLabel?: string;
}

export class CreateContractDto {
  @ApiProperty({ description: 'Project ID this contract belongs to' })
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @ApiProperty({ description: 'Client ID' })
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  // CONST-COM-020 (ADR-030 / commercial-workspace-redesign S-CC-1): a CLIENT_CONTRACT binds to the
  // project's single committed BOQ, which the server RESOLVES — no version is selected or selectable.
  // Optional so the minimal create form (client + dates) posts nothing here. When supplied (the old
  // form, or a SUBCONTRACT anchoring an explicit version) the service still honours it, but it must
  // equal the resolved committed version or the create is rejected.
  @ApiPropertyOptional({
    description:
      'BOQ Version ID. Optional: for a CLIENT_CONTRACT the server resolves the single committed BOQ; ' +
      'if supplied it must equal that resolved version.',
  })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  boqVersionId?: string;

  // CONST-COM-022 (S-CC-3): the client contract number is system-generated from the project code
  // (`{projectCode}-C{n}`) via an atomic per-project sequence. Optional so the create form sends
  // nothing; the old form's supplied number is still honoured, with the duplicate guard intact.
  @ApiPropertyOptional({ example: 'ACCO-WBR-26-0065-C1' })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  contractNumber?: string;

  // CONST-COM-021 (S-CC-1): contract value is the committed-BOQ in-contract tie-out, read-only.
  // Optional so the value input can be dropped from the form. When supplied it must EQUAL the tie-out
  // (TIEOUT_MISMATCH, ADR-029) — it never overrides. A SUBCONTRACT still supplies its own value.
  @ApiPropertyOptional({ example: '5000000.00' })
  @IsDecimal()
  @IsOptional()
  contractValue?: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @MaxLength(3)
  currency!: string;

  // S-CC-4 / ADR-030 CD-consequences: MILESTONE (payment-schedule) is ACCO's default billing model,
  // applied server-side when omitted. MEASURED_IPC is still selectable for measured contracts.
  @ApiPropertyOptional({ enum: BillingModel, default: BillingModel.MILESTONE })
  @IsEnum(BillingModel)
  @IsOptional()
  billingModel?: BillingModel;

  @ApiPropertyOptional({
    enum: ContractKind,
    default: ContractKind.CLIENT_CONTRACT,
    description: 'CLIENT_CONTRACT = main client-facing agreement (at most one effective per project). SUBCONTRACT = subcontractor agreement.',
  })
  @IsEnum(ContractKind)
  @IsOptional()
  contractKind?: ContractKind;

  @ApiPropertyOptional({ example: '2026-01-15' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2027-12-31' })
  @IsDateString()
  @IsOptional()
  expectedEndDate?: string;

  @ApiPropertyOptional({
    type: [PaymentInstallmentDto],
    description:
      'ADR-023: negotiated payment schedule for a MILESTONE (payment-schedule) contract. ' +
      'Σ(percentage) must equal 1. Omit for MEASURED_IPC (certified-progress) contracts.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PaymentInstallmentDto)
  @IsOptional()
  paymentPlan?: PaymentInstallmentDto[];
}
