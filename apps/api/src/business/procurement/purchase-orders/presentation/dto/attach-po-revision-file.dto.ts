import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AttachPoRevisionFileDto {
  @ApiProperty({ description: 'ID of a fully uploaded (READY) PlatformFile' })
  @IsString()
  platformFileId: string;

  @ApiPropertyOptional({ enum: ['QUOTATION', 'OTHER'], default: 'QUOTATION' })
  @IsOptional()
  @IsEnum(['QUOTATION', 'OTHER'])
  purpose?: 'QUOTATION' | 'OTHER';

  @ApiPropertyOptional({ description: "Supplier's own reference on the quotation document" })
  @IsOptional()
  @IsString()
  supplierRef?: string;
}
