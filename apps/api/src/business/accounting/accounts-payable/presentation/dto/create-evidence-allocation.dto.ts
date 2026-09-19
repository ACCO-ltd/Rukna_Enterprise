import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class CreateEvidenceAllocationDto {
  @ApiProperty({ description: 'Supplier bill ID that evidences the spending of this advance' })
  @IsString() @IsNotEmpty()
  supplierBillId!: string;

  @ApiProperty({ example: 1200, description: 'Amount of the advance attributed to this bill' })
  @IsNumber() @Min(0.01)
  allocatedAmount!: number;
}
