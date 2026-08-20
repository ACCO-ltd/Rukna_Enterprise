import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SetInstallmentMilestoneDto {
  @ApiPropertyOptional({
    description: 'Programme milestone id to link as billing evidence, or null to unlink.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  programmeMilestoneId?: string | null;
}
