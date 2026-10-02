import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { ContactInputDto } from './contact-input.dto.js';

export class AddContactDto extends ContactInputDto {
  @ApiPropertyOptional({
    default: false,
    description: "true demotes the current primary. A client's first contact is always primary.",
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
