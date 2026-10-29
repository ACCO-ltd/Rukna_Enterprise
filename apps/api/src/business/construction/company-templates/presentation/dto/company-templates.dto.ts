import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumberString,
  IsString,
  ValidateNested,
} from 'class-validator';

// Shape only — the business rules (totals 100%, one advance, unique phase names, 1–365 days) live
// in domain/template-rules.ts so the errors come back as one readable list.

export class PaymentPlanTemplateRowDto {
  @ApiProperty({ example: 'Advance (mobilisation)' })
  @IsString()
  name!: string;

  @ApiProperty({ example: '40', description: 'Decimal string; all stages must total 100' })
  @IsNumberString()
  percentage!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  isAdvance!: boolean;
}

export class UpdatePaymentPlanTemplateDto {
  @ApiProperty({ type: [PaymentPlanTemplateRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PaymentPlanTemplateRowDto)
  rows!: PaymentPlanTemplateRowDto[];
}

export class ScheduleTemplatePhaseInputDto {
  @ApiProperty({ example: 'Excavation & Foundation Works' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 21 })
  @IsInt()
  durationDays!: number;

  @ApiProperty({ example: false, description: 'A dates-only phase with no BOQ scope' })
  @IsBoolean()
  scheduleOnly!: boolean;
}

export class UpdateScheduleTemplateDto {
  @ApiProperty({ type: [ScheduleTemplatePhaseInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ScheduleTemplatePhaseInputDto)
  phases!: ScheduleTemplatePhaseInputDto[];
}
