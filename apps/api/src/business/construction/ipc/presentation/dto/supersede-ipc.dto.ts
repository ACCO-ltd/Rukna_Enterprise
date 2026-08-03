import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SupersedeIpcDto {
  @ApiProperty({ description: 'The new certificate ID that should become effective' })
  @IsString()
  @IsNotEmpty()
  newCertificateId!: string;

  @ApiProperty({ description: 'Reason for superseding the current effective certificate' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
