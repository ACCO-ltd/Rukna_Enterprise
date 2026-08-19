import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, MaxLength } from 'class-validator';
import { DocumentCategory } from '@prisma/client';

export class AttachDocumentDto {
  @ApiProperty({ description: 'A confirmed (READY) PlatformFile id' })
  @IsString() @IsNotEmpty()
  platformFileId!: string;

  @ApiProperty({ enum: DocumentCategory })
  @IsEnum(DocumentCategory)
  category!: DocumentCategory;

  @ApiProperty({ example: 'Building permit' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  title!: string;
}
