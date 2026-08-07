import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { CreateAccountDto } from './create-account.dto.js';

export class ImportCoaDto {
  @ApiProperty({ type: [CreateAccountDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateAccountDto)
  accounts!: CreateAccountDto[];
}
