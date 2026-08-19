import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class InitiateUploadDto {
  @ApiProperty({ example: 'building-permit.pdf' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  originalName!: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  mimeType!: string;
}

export class ConfirmUploadDto {
  @ApiPropertyOptional({ description: 'Client-computed SHA-256, stored as the integrity record' })
  @IsString() @IsOptional() @MaxLength(128)
  checksumSha256?: string;
}
