import { IsDefined, IsEnum, IsInt, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClientType } from '@prisma/client';

import { ContactInputDto } from './contact-input.dto.js';

/** Client master-data fields shared by create and update (shape only — rules in domain/client-input.ts). */
export class ClientFieldsDto {
  @ApiPropertyOptional({ enum: ClientType, default: ClientType.COMPANY })
  @IsOptional()
  @IsEnum(ClientType)
  type?: ClientType;

  @ApiPropertyOptional({ example: 'SO123456789', nullable: true })
  @IsOptional()
  @IsString()
  taxNumber?: string | null;

  @ApiPropertyOptional({ description: 'Business licence / company registration', nullable: true })
  @IsOptional()
  @IsString()
  registrationNumber?: string | null;

  @ApiPropertyOptional({ description: 'Default invoice terms, 0–365 days', nullable: true })
  @IsOptional()
  @IsInt()
  paymentTermsDays?: number | null;

  @ApiPropertyOptional({ example: 'SO', description: 'ISO-3166 alpha-2' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ example: 'Mogadishu', nullable: true })
  @IsOptional()
  @IsString()
  city?: string | null;

  @ApiPropertyOptional({ description: 'Street / building line', nullable: true })
  @IsOptional()
  @IsString()
  address?: string | null;

  @ApiPropertyOptional({ description: "Where invoices go (falls back to the primary contact's email)", nullable: true })
  @IsOptional()
  @IsString()
  invoiceEmail?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  defaultCurrency?: string;
}

export class CreateClientDto extends ClientFieldsDto {
  @ApiProperty({ example: 'Ministry of Finance' })
  @IsString()
  name!: string;

  @ApiProperty({ type: ContactInputDto, description: 'Required — a client is someone ACCO can reach.' })
  @IsDefined()
  @ValidateNested()
  @Type(() => ContactInputDto)
  primaryContact!: ContactInputDto;
}
