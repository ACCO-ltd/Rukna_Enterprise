import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, Length, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClientType } from '@prisma/client';

export class PrimaryContactDto {
  @ApiProperty({ example: 'Ahmed Hassan' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'Commercial Director' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  role?: string;

  @ApiPropertyOptional({ example: '+252612345678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'ahmed@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class CreateClientDto {
  @ApiProperty({ example: 'Ministry of Finance' })
  @IsString()
  name!: string;


  @ApiPropertyOptional({ enum: ClientType, default: ClientType.COMPANY })
  @IsOptional()
  @IsEnum(ClientType)
  type?: ClientType;

  @ApiPropertyOptional({ example: 'SO123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxNumber?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  defaultCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: PrimaryContactDto, description: 'Optional primary contact, persisted atomically with the client.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrimaryContactDto)
  primaryContact?: PrimaryContactDto;
}
