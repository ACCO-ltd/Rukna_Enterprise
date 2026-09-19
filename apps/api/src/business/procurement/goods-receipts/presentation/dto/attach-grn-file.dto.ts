import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AttachGrnFileDto {
  @ApiProperty({ description: 'ID of a fully uploaded (READY) PlatformFile' })
  @IsString()
  platformFileId: string;

  @ApiPropertyOptional({ enum: ['DELIVERY_NOTE', 'OTHER'], default: 'DELIVERY_NOTE' })
  @IsOptional()
  @IsEnum(['DELIVERY_NOTE', 'OTHER'])
  purpose?: 'DELIVERY_NOTE' | 'OTHER';
}
