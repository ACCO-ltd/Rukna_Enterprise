import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsDecimal, IsNotEmpty } from 'class-validator';

export class AllocateReceiptDto {
  @ApiProperty({ description: 'IPC ID to allocate this payment against' })
  @IsString()
  @IsNotEmpty()
  certificateId!: string;

  @ApiProperty({ description: 'Amount to allocate (must not exceed receipt unallocated balance)' })
  @IsDecimal()
  allocatedAmount!: string;
}
